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

async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.warn(
      "DATABASE_URL이 없습니다. Render에 Postgres를 연결해주세요."
    );
    return;
  }

  await db(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  await db(`CREATE TABLE IF NOT EXISTS quiz_questions (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    question TEXT NOT NULL,
    type TEXT NOT NULL,
    options JSONB NOT NULL,
    answer TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 10
  )`);

  await db(`CREATE TABLE IF NOT EXISTS quiz_meta (
    id INTEGER PRIMARY KEY CHECK (id=1),
    title TEXT NOT NULL DEFAULT '우리들의 퀴즈쇼'
  )`);

  await db(`INSERT INTO quiz_meta(id,title)
            VALUES(1,'우리들의 퀴즈쇼')
            ON CONFLICT(id) DO NOTHING`);

  await db(`CREATE TABLE IF NOT EXISTS host_accounts (
    id SERIAL PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await db(`CREATE TABLE IF NOT EXISTS workspace_quizzes (
    host_account_id INTEGER PRIMARY KEY REFERENCES host_accounts(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '우리들의 퀴즈쇼',
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const old = await db(
    "SELECT value FROM app_settings WHERE key='host_password_hash'"
  );

  const account = await db(
    "SELECT id FROM host_accounts WHERE id=1"
  );

  if (old.rows[0] && !account.rows[0]) {
    await db(
      "INSERT INTO host_accounts(id,password_hash) VALUES(1,$1)",
      [old.rows[0].value]
    );

    await db(
      "SELECT setval(pg_get_serial_sequence('host_accounts','id'), GREATEST((SELECT MAX(id) FROM host_accounts),1))"
    );
  }
}

async function getLegacyQuiz() {
  if (!process.env.DATABASE_URL) {
    return {
      title: "우리들의 퀴즈쇼",
      questions: []
    };
  }

  const meta = await db(
    "SELECT title FROM quiz_meta WHERE id=1"
  );

  const rows = await db(
    "SELECT id,question,type,options,answer,points FROM quiz_questions ORDER BY position ASC"
  );

  return {
    title:
      meta.rows[0]?.title ||
      "우리들의 퀴즈쇼",
    questions: rows.rows
  };
}

async function saveLegacyQuiz(title, questions) {
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
        "INSERT INTO quiz_questions(id,position,question,type,options,answer,points) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          String(
            q.id ||
            "q" +
              Date.now() +
              i
          ),
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

async function getWorkspaceQuiz(accountId) {
  if (!process.env.DATABASE_URL) {
    return {
      title: "우리들의 퀴즈쇼",
      questions: []
    };
  }

  const r = await db(
    "SELECT title,questions FROM workspace_quizzes WHERE host_account_id=$1",
    [accountId]
  );

  if (!r.rows[0]) {
    return {
      title: "우리들의 퀴즈쇼",
      questions: []
    };
  }

  return {
    title:
      r.rows[0].title ||
      "우리들의 퀴즈쇼",

    questions:
      Array.isArray(r.rows[0].questions)
        ? r.rows[0].questions
        : []
  };
}

async function saveWorkspaceQuiz(
  accountId,
  title,
  questions
) {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL이 설정되지 않았습니다."
    );
  }

  await db(
    `INSERT INTO workspace_quizzes(host_account_id,title,questions,updated_at)
     VALUES($1,$2,$3,NOW())
     ON CONFLICT(host_account_id)
     DO UPDATE SET title=EXCLUDED.title,
                   questions=EXCLUDED.questions,
                   updated_at=NOW()`,
    [
      accountId,
      title || "우리들의 퀴즈쇼",
      JSON.stringify(
        Array.isArray(questions)
          ? questions
          : []
      )
    ]
  );
}

async function getQuizForAccount(accountId) {
  if (Number(accountId) === 1) {
    return getLegacyQuiz();
  }

  return getWorkspaceQuiz(accountId);
}

async function saveQuizForAccount(
  accountId,
  title,
  questions
) {
  if (Number(accountId) === 1) {
    return saveLegacyQuiz(
      title,
      questions
    );
  }

  return saveWorkspaceQuiz(
    accountId,
    title,
    questions
  );
}

async function passwordExists() {
  if (!process.env.DATABASE_URL) {
    return false;
  }

  const r = await db(
    "SELECT id FROM host_accounts ORDER BY id LIMIT 1"
  );

  return !!r.rows[0];
}

async function checkPassword(password) {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  const r = await db(
    "SELECT id,password_hash FROM host_accounts ORDER BY id ASC"
  );

  for (const row of r.rows) {
    if (
      await bcrypt.compare(
        password,
        row.password_hash
      )
    ) {
      return Number(row.id);
    }
  }

  return null;
}

async function createHostAccount(password) {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL이 설정되지 않았습니다."
    );
  }

  const hash =
    await bcrypt.hash(
      password,
      12
    );

  const r = await db(
    "INSERT INTO host_accounts(password_hash) VALUES($1) RETURNING id",
    [hash]
  );

  return Number(r.rows[0].id);
}

async function hasPasswordDuplicate(password) {
  if (!process.env.DATABASE_URL) {
    return false;
  }

  const r = await db(
    "SELECT password_hash FROM host_accounts"
  );

  for (const row of r.rows) {
    if (
      await bcrypt.compare(
        password,
        row.password_hash
      )
    ) {
      return true;
    }
  }

  return false;
}

const rooms = new Map();
const hostSessions = new Set();

function code() {
  return crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase();
}

/* =========================
   보기 없음 정답 확인
========================= */

function isNoOptionAnswer(answer) {
  return String(answer || "")
    .startsWith("__NO_OPTION__|");
}

function cleanRoom(room) {
  return {
    code: room.code,
    title: room.title,
    questions: room.questions,
    current: room.current,
    locked: room.locked,
    revealed: room.revealed,

    participants:
      [
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

function requireHost(socket) {
  return (
    !!socket.data.hostAuth &&
    !!socket.data.accountId
  );
}

app.get(
  "/health",
  (_, res) =>
    res.json({ ok: true })
);

app.get(
  "/host",
  (_, res) =>
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    )
);

app.get(
  "/join",
  (_, res) =>
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    )
);

app.get(
  "/",
  (_, res) =>
    res.redirect("/join")
);

io.on("connection", socket => {

  socket.on(
    "host:status",
    async () => {
      try {
        socket.emit(
          "host:status",
          {
            configured:
              await passwordExists()
          }
        );
      } catch (e) {
        console.error(e);

        socket.emit(
          "errorMsg",
          "DB 연결을 확인해주세요."
        );
      }
    }
  );

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
                "이미 진행자 비밀번호가 설정되어 있습니다. 기존 비밀번호를 사용해주세요."
            }
          );
        }

        password =
          String(password || "");

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

        const accountId =
          await createHostAccount(
            password
          );

        hostSessions.add(
          socket.id
        );

        socket.data.hostAuth =
          true;

        socket.data.accountId =
          accountId;

        socket.emit(
          "host:passwordSet",
          {
            ok: true,
            accountId
          }
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

  socket.on(
    "host:login",
    async password => {
      try {
        const accountId =
          await checkPassword(
            String(password || "")
          );

        if (accountId) {
          hostSessions.add(
            socket.id
          );

          socket.data.hostAuth =
            true;

          socket.data.accountId =
            accountId;

          socket.emit(
            "host:loginResult",
            {
              ok: true,
              accountId
            }
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

  socket.on(
    "host:createPassword",
    async password => {
      if (!requireHost(socket)) {
        return socket.emit(
          "host:createPasswordResult",
          {
            ok: false,
            message:
              "먼저 기존 진행자 비밀번호로 로그인해주세요."
          }
        );
      }

      try {
        password =
          String(password || "");

        if (password.length < 4) {
          return socket.emit(
            "host:createPasswordResult",
            {
              ok: false,
              message:
                "새 비밀번호는 4자 이상으로 설정해주세요."
            }
          );
        }

        if (
          await hasPasswordDuplicate(
            password
          )
        ) {
          return socket.emit(
            "host:createPasswordResult",
            {
              ok: false,
              message:
                "이미 사용 중인 비밀번호입니다. 다른 비밀번호를 사용해주세요."
            }
          );
        }

        const accountId =
          await createHostAccount(
            password
          );

        socket.emit(
          "host:createPasswordResult",
          {
            ok: true,
            accountId,
            message:
              "새 진행자 비밀번호가 만들어졌습니다."
          }
        );

      } catch (e) {
        console.error(e);

        socket.emit(
          "host:createPasswordResult",
          {
            ok: false,
            message:
              "새 비밀번호 저장에 실패했습니다."
          }
        );
      }
    }
  );

  socket.on(
    "host:getQuiz",
    async () => {
      if (!requireHost(socket)) {
        return socket.emit(
          "errorMsg",
          "진행자 로그인이 필요합니다."
        );
      }

      try {
        socket.emit(
          "host:quiz",
          await getQuizForAccount(
            socket.data.accountId
          )
        );
      } catch (e) {
        console.error(e);

        socket.emit(
          "errorMsg",
          "저장된 퀴즈를 불러오지 못했습니다."
        );
      }
    }
  );

  socket.on(
    "host:saveQuiz",
    async ({
      title,
      questions
    }) => {
      if (!requireHost(socket)) {
        return socket.emit(
          "errorMsg",
          "진행자 로그인이 필요합니다."
        );
      }

      try {
        await saveQuizForAccount(
          socket.data.accountId,
          title,
          Array.isArray(
            questions
          )
            ? questions
            : []
        );

        socket.emit(
          "host:saved"
        );

      } catch (e) {
        console.error(e);

        socket.emit(
          "errorMsg",
          "퀴즈 저장에 실패했습니다."
        );
      }
    }
  );

  socket.on(
    "host:create",
    async ({
      title,
      questions
    }) => {
      if (!requireHost(socket)) {
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
        participants:
          new Map(),
        host: socket.id,
        ownerAccountId:
          Number(
            socket.data.accountId
          )
      };

      rooms.set(c, room);

      socket.join(c);

      socket.data.room = c;
      socket.data.role = "host";

      try {
        await saveQuizForAccount(
          socket.data.accountId,
          room.title,
          quiz
        );
      } catch (e) {
        console.error(e);
      }

      socket.emit(
        "host:created",
        { code: c }
      );

      broadcast(room);
    }
  );

  socket.on(
    "host:load",
    ({ code: c }) => {
      if (!requireHost(socket)) {
        return socket.emit(
          "errorMsg",
          "진행자 로그인이 필요합니다."
        );
      }

      const room =
        rooms.get(
          String(c || "")
            .toUpperCase()
        );

      if (!room) {
        return socket.emit(
          "errorMsg",
          "존재하지 않는 방입니다."
        );
      }

      if (
        Number(
          room.ownerAccountId
        ) !==
        Number(
          socket.data.accountId
        )
      ) {
        return socket.emit(
          "errorMsg",
          "이 비밀번호로 만든 방이 아닙니다."
        );
      }

      room.host = socket.id;

      socket.join(room.code);

      socket.data.room =
        room.code;

      socket.data.role =
        "host";

      socket.emit(
        "host:ok",
        { code: room.code }
      );

      broadcast(room);
    }
  );

  socket.on(
    "host:question",
    async ({
      index,
      question
    }) => {
      const room =
        rooms.get(
          socket.data.room
        );

      if (
        !room ||
        !requireHost(socket) ||
        Number(
          room.ownerAccountId
        ) !==
          Number(
            socket.data.accountId
          )
      ) {
        return;
      }

      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index <
          room.questions.length
      ) {
        room.current =
          index;
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
        await saveQuizForAccount(
          socket.data.accountId,
          room.title,
          room.questions
        );
      } catch (e) {
        console.error(e);
      }

      broadcast(room);
    }
  );

  socket.on(
    "host:updateQuestions",
    async questions => {
      const room =
        rooms.get(
          socket.data.room
        );

      if (
        !room ||
        !requireHost(socket) ||
        Number(
          room.ownerAccountId
        ) !==
          Number(
            socket.data.accountId
          )
      ) {
        return;
      }

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
        await saveQuizForAccount(
          socket.data.accountId,
          room.title,
          room.questions
        );
      } catch (e) {
        console.error(e);
      }

      broadcast(room);
    }
  );

  socket.on(
    "host:lock",
    () => {
      const r =
        rooms.get(
          socket.data.room
        );

      if (
        !r ||
        !requireHost(socket) ||
        Number(
          r.ownerAccountId
        ) !==
          Number(
            socket.data.accountId
          )
      ) {
        return;
      }

      r.locked = true;

      broadcast(r);
    }
  );

  socket.on(
    "host:unlock",
    () => {
      const r =
        rooms.get(
          socket.data.room
        );

      if (
        !r ||
        !requireHost(socket) ||
        Number(
          r.ownerAccountId
        ) !==
          Number(
            socket.data.accountId
          )
      ) {
        return;
      }

      r.locked = false;

      broadcast(r);
    }
  );

  /* =========================
     정답 공개 및 점수 처리
     보기 없음이면 모든 선택 오답
  ========================= */

  socket.on(
    "host:reveal",
    async () => {
      const r =
        rooms.get(
          socket.data.room
        );

      if (
        !r ||
        !requireHost(socket) ||
        Number(
          r.ownerAccountId
        ) !==
          Number(
            socket.data.accountId
          )
      ) {
        return;
      }

      r.revealed = true;

      const q =
        r.questions[
          r.current
        ];

      for (
        const p of r.participants.values()
      ) {

        /*
          보기 없음(__NO_OPTION__)인 경우
          참가자의 선택지와 절대로 일치하지 않으므로
          모든 선택이 오답 처리됩니다.
        */

        if (
          p.answer &&
          q &&
          !isNoOptionAnswer(
            q.answer
          ) &&
          p.answer === q.answer
        ) {
          p.score +=
            Number(q.points) || 0;
        }
      }

      r.locked = true;

      broadcast(r);
    }
  );

  socket.on(
    "host:next",
    () => {
      const r =
        rooms.get(
          socket.data.room
        );

      if (
        !r ||
        !requireHost(socket) ||
        Number(
          r.ownerAccountId
        ) !==
          Number(
            socket.data.accountId
          )
      ) {
        return;
      }

      if (
        r.current <
        r.questions.length - 1
      ) {
        r.current++;
      }

      r.locked = false;
      r.revealed = false;

      for (
        const p of r.participants.values()
      ) {
        p.answer = null;
      }

      broadcast(r);
    }
  );

  socket.on(
    "host:prev",
    () => {
      const r =
        rooms.get(
          socket.data.room
        );

      if (
        !r ||
        !requireHost(socket) ||
        Number(
          r.ownerAccountId
        ) !==
          Number(
            socket.data.accountId
          )
      ) {
        return;
      }

      if (r.current > 0) {
        r.current--;
      }

      r.locked = false;
      r.revealed = false;

      for (
        const p of r.participants.values()
      ) {
        p.answer = null;
      }

      broadcast(r);
    }
  );

  socket.on(
    "host:resetScores",
    () => {
      const r =
        rooms.get(
          socket.data.room
        );

      if (
        !r ||
        !requireHost(socket) ||
        Number(
          r.ownerAccountId
        ) !==
          Number(
            socket.data.accountId
          )
      ) {
        return;
      }

      for (
        const p of r.participants.values()
      ) {
        p.score = 0;
      }

      broadcast(r);
    }
  );

  socket.on(
    "join",
    ({
      code: c,
      name
    }) => {
      const r =
        rooms.get(
          String(c || "")
            .toUpperCase()
        );

      if (!r) {
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

      r.participants.set(
        socket.id,
        p
      );

      socket.join(r.code);

      socket.data.room =
        r.code;

      socket.data.role =
        "player";

      socket.emit(
        "joined",
        {
          code: r.code,
          name: n
        }
      );

      broadcast(r);
    }
  );

  socket.on(
    "answer",
    value => {
      const r =
        rooms.get(
          socket.data.room
        );

      if (
        !r ||
        socket.data.role !==
          "player"
      ) {
        return;
      }

      const p =
        r.participants.get(
          socket.id
        );

      if (
        !p ||
        r.locked ||
        r.revealed
      ) {
        return;
      }

      const q =
        r.questions[
          r.current
        ];

      if (!q) return;

      if (
        q.options.some(
          o =>
            o.value === value
        )
      ) {
        p.answer = value;

        broadcast(r);
      }
    }
  );

  socket.on(
    "disconnect",
    () => {
      hostSessions.delete(
        socket.id
      );

      const c =
        socket.data.room;

      if (!c) return;

      const r =
        rooms.get(c);

      if (!r) return;

      if (
        socket.data.role ===
        "player"
      ) {
        r.participants.delete(
          socket.id
        );
      } else if (
        r.host === socket.id
      ) {
        r.host = null;
      }

      broadcast(r);
    }
  );
});

const PORT =
  process.env.PORT || 3000;

initDb()
  .then(() =>
    server.listen(
      PORT,
      "0.0.0.0",
      () =>
        console.log(
          "QuizShow running on 0.0.0.0:" +
          PORT
        )
    )
  )
  .catch(e => {
    console.error(
      "DB 초기화 실패",
      e
    );

    process.exit(1);
  });
