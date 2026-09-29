const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

async function db(sql, params = []) {
  return pool.query(sql, params);
}

/* =========================
   DATABASE
========================= */

async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.warn(
      "DATABASE_URL이 없습니다. Render에 Postgres를 연결해주세요."
    );
    return;
  }

  await db(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id TEXT PRIMARY KEY,
      position INTEGER NOT NULL,
      question TEXT NOT NULL,
      type TEXT NOT NULL,
      options JSONB NOT NULL,
      answer TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 10
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS quiz_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      title TEXT NOT NULL DEFAULT '우리들의 퀴즈쇼'
    )
  `);

  await db(`
    INSERT INTO quiz_meta(id, title)
    VALUES (1, '우리들의 퀴즈쇼')
    ON CONFLICT(id) DO NOTHING
  `);

  /* 방 영구 저장 테이블 */
  await db(`
    CREATE TABLE IF NOT EXISTS quiz_rooms (
      code TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      current INTEGER NOT NULL DEFAULT 0,
      locked BOOLEAN NOT NULL DEFAULT false,
      revealed BOOLEAN NOT NULL DEFAULT false
    )
  `);
}

/* =========================
   QUIZ
========================= */

async function getQuiz() {
  if (!process.env.DATABASE_URL) {
    return {
      title: "우리들의 퀴즈쇼",
      questions: []
    };
  }

  const meta = await db(
    "SELECT title FROM quiz_meta WHERE id = 1"
  );

  const rows = await db(`
    SELECT id, question, type, options, answer, points
    FROM quiz_questions
    ORDER BY position ASC
  `);

  return {
    title:
      meta.rows[0]?.title ||
      "우리들의 퀴즈쇼",
    questions: rows.rows
  };
}

async function saveQuiz(title, questions) {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL이 설정되지 않았습니다."
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      "UPDATE quiz_meta SET title=$1 WHERE id=1",
      [title || "우리들의 퀴즈쇼"]
    );

    await client.query(
      "DELETE FROM quiz_questions"
    );

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];

      await client.query(
        `
        INSERT INTO quiz_questions
        (id, position, question, type, options, answer, points)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          String(q.id || "q" + Date.now() + i),
          i,
          String(q.question || ""),
          String(q.type || "single"),
          JSON.stringify(q.options || []),
          String(q.answer || ""),
          Number(q.points) || 0
        ]
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/* =========================
   ROOM SAVE / LOAD
========================= */

/*
  현재 방 상태를 Postgres에 저장
*/
async function saveRoom(room) {
  if (!process.env.DATABASE_URL) return;

  await db(
    `
    INSERT INTO quiz_rooms
      (
        code,
        title,
        questions,
        current,
        locked,
        revealed
      )
    VALUES
      ($1,$2,$3,$4,$5,$6)

    ON CONFLICT (code)
    DO UPDATE SET
      title = EXCLUDED.title,
      questions = EXCLUDED.questions,
      current = EXCLUDED.current,
      locked = EXCLUDED.locked,
      revealed = EXCLUDED.revealed
    `,
    [
      room.code,
      room.title,
      JSON.stringify(room.questions || []),
      room.current || 0,
      !!room.locked,
      !!room.revealed
    ]
  );
}

/*
  서버 시작 시 DB에 저장된 방을 불러옴
*/
async function loadRooms() {
  if (!process.env.DATABASE_URL) return;

  const result = await db(`
    SELECT
      code,
      title,
      questions,
      current,
      locked,
      revealed
    FROM quiz_rooms
    ORDER BY code
  `);

  for (const row of result.rows) {
    rooms.set(row.code, {
      code: row.code,
      title: row.title,
      questions: row.questions || [],
      current: Number(row.current) || 0,
      locked: !!row.locked,
      revealed: !!row.revealed,

      /*
        서버 재시작 직후에는 실제 Socket.IO 연결이 없으므로
        참가자 목록은 비워둠.
      */
      participants: new Map(),

      host: null
    });
  }

  console.log(
    `저장된 방 ${result.rows.length}개를 불러왔습니다.`
  );
}

/* =========================
   PASSWORD
========================= */

async function passwordExists() {
  if (!process.env.DATABASE_URL) return false;

  const r = await db(`
    SELECT value
    FROM app_settings
    WHERE key='host_password_hash'
  `);

  return !!r.rows[0];
}

async function setPassword(password) {
  const hash = await bcrypt.hash(password, 12);

  await db(
    `
    INSERT INTO app_settings(key,value)
    VALUES('host_password_hash',$1)

    ON CONFLICT(key)
    DO UPDATE SET value=EXCLUDED.value
    `,
    [hash]
  );
}

async function checkPassword(password) {
  const r = await db(`
    SELECT value
    FROM app_settings
    WHERE key='host_password_hash'
  `);

  if (!r.rows[0]) return false;

  return bcrypt.compare(
    password,
    r.rows[0].value
  );
}

/* =========================
   ROOM STATE
========================= */

const rooms = new Map();
const hostSessions = new Set();

function code() {
  return crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase();
}

function cleanRoom(room) {
  return {
    code: room.code,
    title: room.title,
    questions: room.questions,
    current: room.current,
    locked: room.locked,
    revealed: room.revealed,

    participants: [
      ...room.participants.values()
    ].map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      answer: p.answer
    }))
  };
}

function broadcast(room) {
  io.to(room.code).emit(
    "state",
    cleanRoom(room)
  );
}

/* =========================
   ROUTES
========================= */

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

app.get("/host", (_, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

app.get("/join", (_, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

app.get("/", (_, res) => {
  res.redirect("/join");
});

/* =========================
   SOCKET.IO
========================= */

io.on("connection", socket => {

  /* -------------------------
     HOST STATUS
  ------------------------- */

  socket.on("host:status", async () => {
    try {
      socket.emit("host:status", {
        configured: await passwordExists()
      });
    } catch (e) {
      console.error(e);

      socket.emit(
        "errorMsg",
        "DB 연결을 확인해주세요."
      );
    }
  });

  /* -------------------------
     HOST PASSWORD SETUP
  ------------------------- */

  socket.on(
    "host:setupPassword",
    async password => {
      try {
        if (await passwordExists()) {
          return socket.emit(
            "host:passwordSet",
            {
              ok: false,
              message:
                "이미 진행자 비밀번호가 설정되어 있습니다."
            }
          );
        }

        password = String(password || "");

        if (password.length < 4) {
          return socket.emit(
            "host:passwordSet",
            {
              ok: false,
              message:
                "비밀번호는 4자 이상으로 설정해주세요."
            }
          );
        }

        await setPassword(password);

        hostSessions.add(socket.id);
        socket.data.hostAuth = true;

        socket.emit(
          "host:passwordSet",
          { ok: true }
        );

      } catch (e) {
        console.error(e);

        socket.emit(
          "host:passwordSet",
          {
            ok: false,
            message:
              "비밀번호 저장에 실패했습니다."
          }
        );
      }
    }
  );

  /* -------------------------
     HOST LOGIN
  ------------------------- */

  socket.on(
    "host:login",
    async password => {
      try {
        if (
          await checkPassword(
            String(password || "")
          )
        ) {
          hostSessions.add(socket.id);
          socket.data.hostAuth = true;

          socket.emit(
            "host:loginResult",
            { ok: true }
          );
        } else {
          socket.emit(
            "host:loginResult",
            {
              ok: false,
              message:
                "비밀번호가 맞지 않습니다."
            }
          );
        }
      } catch (e) {
        console.error(e);

        socket.emit(
          "host:loginResult",
          {
            ok: false,
            message:
              "DB 연결을 확인해주세요."
          }
        );
      }
    }
  );

  /* -------------------------
     GET SAVED QUIZ
  ------------------------- */

  socket.on("host:getQuiz", async () => {
    if (!socket.data.hostAuth) {
      return socket.emit(
        "errorMsg",
        "진행자 로그인이 필요합니다."
      );
    }

    try {
      socket.emit(
        "host:quiz",
        await getQuiz()
      );
    } catch (e) {
      console.error(e);

      socket.emit(
        "errorMsg",
        "저장된 퀴즈를 불러오지 못했습니다."
      );
    }
  });

  /* -------------------------
     SAVE QUIZ
  ------------------------- */

  socket.on(
    "host:saveQuiz",
    async ({ title, questions }) => {

      if (!socket.data.hostAuth) {
        return socket.emit(
          "errorMsg",
          "진행자 로그인이 필요합니다."
        );
      }

      try {
        await saveQuiz(
          title,
          Array.isArray(questions)
            ? questions
            : []
        );

        /*
          현재 방이 있다면 방의 문제도 같이 갱신
        */
        const room =
          rooms.get(socket.data.room);

        if (room) {
          room.title =
            title || room.title;

          room.questions =
            Array.isArray(questions)
              ? questions
              : [];

          if (
            room.current >=
            room.questions.length
          ) {
            room.current = 0;
          }

          await saveRoom(room);

          broadcast(room);
        }

        socket.emit("host:saved");

      } catch (e) {
        console.error(e);

        socket.emit(
          "errorMsg",
          "퀴즈 저장에 실패했습니다."
        );
      }
    }
  );

  /* -------------------------
     CREATE ROOM
  ------------------------- */

  socket.on(
    "host:create",
    async ({ title, questions }) => {

      if (!socket.data.hostAuth) {
        return socket.emit(
          "errorMsg",
          "진행자 로그인이 필요합니다."
        );
      }

      let c = code();

      while (rooms.has(c)) {
        c = code();
      }

      const quiz =
        Array.isArray(questions)
          ? questions
          : [];

      const room = {
        code: c,
        title:
          title || "퀴즈쇼",

        questions: quiz,

        current: 0,

        locked: false,

        revealed: false,

        participants: new Map(),

        host: socket.id
      };

      rooms.set(c, room);

      /*
        방 자체를 DB에 저장
      */
      try {
        await saveRoom(room);
      } catch (e) {
        console.error(
          "방 저장 실패:",
          e
        );
      }

      /*
        기존 퀴즈 저장
      */
      try {
        await saveQuiz(
          room.title,
          quiz
        );
      } catch (e) {
        console.error(
          "퀴즈 저장 실패:",
          e
        );
      }

      socket.join(c);

      socket.data.room = c;
      socket.data.role = "host";

      socket.emit(
        "host:created",
        { code: c }
      );

      broadcast(room);
    }
  );

  /* -------------------------
     LOAD EXISTING ROOM
  ------------------------- */

  socket.on(
    "host:load",
    ({ code: c }) => {

      if (!socket.data.hostAuth) {
        return socket.emit(
          "errorMsg",
          "진행자 로그인이 필요합니다."
        );
      }

      const room =
        rooms.get(
          String(c || "").toUpperCase()
        );

      if (!room) {
        return socket.emit(
          "errorMsg",
          "존재하지 않는 방입니다."
        );
      }

      room.host = socket.id;

      socket.join(room.code);

      socket.data.room =
        room.code;

      socket.data.role =
        "host";

      socket.emit(
        "host:ok"
      );

      broadcast(room);
    }
  );

  /* -------------------------
     CHANGE QUESTION
  ------------------------- */

  socket.on(
    "host:question",
    async ({ index, question }) => {

      const room =
        rooms.get(socket.data.room);

      if (
        !room ||
        !socket.data.hostAuth
      ) return;

      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < room.questions.length
      ) {
        room.current = index;
      }

      if (question) {
        room.questions[
          room.current
        ] = question;
      }

      room.locked = false;
      room.revealed = false;

      for (
        const p of room.participants.values()
      ) {
        p.answer = null;
      }

      try {
        await saveQuiz(
          room.title,
          room.questions
        );

        await saveRoom(room);
      } catch (e) {
        console.error(e);
      }

      broadcast(room);
    }
  );

  /* -------------------------
     UPDATE QUESTIONS
  ------------------------- */

  socket.on(
    "host:updateQuestions",
    async questions => {

      const room =
        rooms.get(socket.data.room);

      if (
        !room ||
        !socket.data.hostAuth
      ) return;

      room.questions =
        Array.isArray(questions)
          ? questions
          : [];

      if (
        room.current >=
        room.questions.length
      ) {
        room.current = 0;
      }

      try {
        await saveQuiz(
          room.title,
          room.questions
        );

        await saveRoom(room);
      } catch (e) {
        console.error(e);
      }

      broadcast(room);
    }
  );

  /* -------------------------
     LOCK
  ------------------------- */

  socket.on(
    "host:lock",
    async () => {

      const room =
        rooms.get(socket.data.room);

      if (!room) return;

      room.locked = true;

      try {
        await saveRoom(room);
      } catch (e) {
        console.error(e);
      }

      broadcast(room);
    }
  );

  /* -------------------------
     UNLOCK
  ------------------------- */

  socket.on(
    "host:unlock",
    async () => {

      const room =
        rooms.get(socket.data.room);

      if (!room) return;

      room.locked = false;

      try {
        await saveRoom(room);
      } catch (e) {
        console.error(e);
      }

      broadcast(room);
    }
  );

  /* -------------------------
     REVEAL ANSWER
  ------------------------- */

  socket.on(
    "host:reveal",
    async () => {

      const room =
        rooms.get(socket.data.room);

      if (!room) return;

      room.revealed = true;

      const q =
        room.questions[
          room.current
        ];

      for (
        const p of room.participants.values()
      ) {
        if (
          p.answer &&
          q &&
          p.answer === q.answer
        ) {
          p.score +=
            Number(q.points) || 0;
        }
      }

      room.locked = true;

      try {
        await saveRoom(room);
      } catch (e) {
        console.error(e);
      }

      broadcast(room);
    }
  );

  /* -------------------------
     NEXT QUESTION
  ------------------------- */

  socket.on(
    "host:next",
    async () => {

      const room =
        rooms.get(socket.data.room);

      if (!room) return;

      if (
        room.current <
        room.questions.length - 1
      ) {
        room.current++;
      }

      room.locked = false;
      room.revealed = false;

      for (
        const p of room.participants.values()
      ) {
        p.answer = null;
      }

      try {
        await saveRoom(room);
      } catch (e) {
        console.error(e);
      }

      broadcast(room);
    }
  );

  /* -------------------------
     PREVIOUS QUESTION
  ------------------------- */

  socket.on(
    "host:prev",
    async () => {

      const room =
        rooms.get(socket.data.room);

      if (!room) return;

      if (room.current > 0) {
        room.current--;
      }

      room.locked = false;
      room.revealed = false;

      for (
        const p of room.participants.values()
      ) {
        p.answer = null;
      }

      try {
        await saveRoom(room);
      } catch (e) {
        console.error(e);
      }

      broadcast(room);
    }
  );

  /* -------------------------
     RESET SCORES
  ------------------------- */

  socket.on(
    "host:resetScores",
    async () => {

      const room =
        rooms.get(socket.data.room);

      if (!room) return;

      for (
        const p of room.participants.values()
      ) {
        p.score = 0;
      }

      /*
        현재 구조에서는 참가자 점수는
        메모리에만 존재하므로
        서버 재시작 시 초기화됨.
      */

      try {
        await saveRoom(room);
      } catch (e) {
        console.error(e);
      }

      broadcast(room);
    }
  );

  /* -------------------------
     PLAYER JOIN
  ------------------------- */

  socket.on(
    "join",
    ({ code: c, name }) => {

      const room =
        rooms.get(
          String(c || "").toUpperCase()
        );

      if (!room) {
        return socket.emit(
          "errorMsg",
          "방 코드를 확인해주세요."
        );
      }

      const n =
        String(name || "")
          .trim()
          .slice(0, 20);

      if (!n) {
        return socket.emit(
          "errorMsg",
          "이름을 입력해주세요."
        );
      }

      const p = {
        id: socket.id,
        name: n,
        score: 0,
        answer: null
      };

      room.participants.set(
        socket.id,
        p
      );

      socket.join(room.code);

      socket.data.room =
        room.code;

      socket.data.role =
        "player";

      socket.emit(
        "joined",
        {
          code: room.code,
          name: n
        }
      );

      broadcast(room);
    }
  );

  /* -------------------------
     PLAYER ANSWER
  ------------------------- */

  socket.on(
    "answer",
    value => {

      const room =
        rooms.get(socket.data.room);

      if (
        !room ||
        socket.data.role !== "player"
      ) return;

      const p =
        room.participants.get(
          socket.id
        );

      if (
        !p ||
        room.locked ||
        room.revealed
      ) return;

      const q =
        room.questions[
          room.current
        ];

      if (!q) return;

      if (
        q.options.some(
          o => o.value === value
        )
      ) {
        p.answer = value;

        broadcast(room);
      }
    }
  );

  /* -------------------------
     DISCONNECT
  ------------------------- */

  socket.on(
    "disconnect",
    () => {

      hostSessions.delete(
        socket.id
      );

      const c =
        socket.data.room;

      if (!c) return;

      const room =
        rooms.get(c);

      if (!room) return;

      /*
        참가자는 연결이 끊기면
        현재 구조상 방에서 제거.
      */

      if (
        socket.data.role === "player"
      ) {
        room.participants.delete(
          socket.id
        );
      }

      /*
        진행자가 나가도
        방 자체는 DB에 계속 남음.
      */

      else if (
        room.host === socket.id
      ) {
        room.host = null;
      }

      broadcast(room);
    }
  );
});

/* =========================
   SERVER START
========================= */

const PORT =
  process.env.PORT || 3000;

initDb()
  .then(() => loadRooms())
  .then(() => {
    server.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          "QuizShow running on 0.0.0.0:" +
          PORT
        );
      }
    );
  })
  .catch(e => {
    console.error(
      "DB 초기화 실패",
      e
    );
    process.exit(1);
  });
