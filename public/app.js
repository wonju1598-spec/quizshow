```js
const socket = io();
const app = document.getElementById("app");

let state = null;
let role = null;
let myAnswer = null;
let myName = "";
let hostQuestions = [];
let hostTitle = "우리들의 퀴즈쇼";
let loadedRoomCode = "";

const sample = [
  {
    id: "q1",
    type: "single",
    question: "대한민국의 수도는?",
    options: [
      { value: "1", label: "서울" },
      { value: "2", label: "부산" },
      { value: "3", label: "대구" },
      { value: "4", label: "인천" }
    ],
    answer: "1",
    points: 10
  },
  {
    id: "q2",
    type: "ox",
    question: "지구는 태양 주위를 돈다.",
    options: [
      { value: "O", label: "O" },
      { value: "X", label: "X" }
    ],
    answer: "O",
    points: 20
  }
];

function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    m => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[m])
  );
}

function labels(type) {
  return type === "ox"
    ? ["O", "X"]
    : type === "ab"
      ? ["A", "B"]
      : ["1", "2", "3", "4"];
}

function makeOptions(type) {
  return labels(type).map(v => ({
    value: v,
    label: v
  }));
}

/* =========================
   HOST LOGIN
========================= */

function hostLogin() {
  socket.emit("host:status");
}

socket.on("host:status", ({ configured }) => {
  if (configured) {
    app.innerHTML = `
      <div class="wrap">
        <div class="card auth">
          <h1>진행자 로그인</h1>
          <p class="muted">진행자 사이트입니다.</p>

          <input
            id="pw"
            type="password"
            placeholder="진행자 비밀번호"
          >

          <button
            class="primary"
            onclick="loginHost()"
          >
            로그인
          </button>
        </div>
      </div>
    `;
  } else {
    app.innerHTML = `
      <div class="wrap">
        <div class="card auth">
          <h1>진행자 비밀번호 설정</h1>

          <p class="muted">
            처음 한 번만 설정하면 이후에는 이 비밀번호로 로그인합니다.
          </p>

          <input
            id="pw"
            type="password"
            placeholder="새 비밀번호 (4자 이상)"
          >

          <input
            id="pw2"
            type="password"
            placeholder="비밀번호 다시 입력"
          >

          <button
            class="primary"
            onclick="setupHost()"
          >
            비밀번호 설정
          </button>
        </div>
      </div>
    `;
  }
});

function loginHost() {
  const pw = document.getElementById("pw")?.value || "";
  socket.emit("host:login", pw);
}

function setupHost() {
  const a = document.getElementById("pw")?.value || "";
  const b = document.getElementById("pw2")?.value || "";

  if (a !== b) {
    return alert("비밀번호가 서로 다릅니다.");
  }

  socket.emit("host:setupPassword", a);
}

socket.on("host:loginResult", r => {
  if (!r.ok) {
    return alert(r.message);
  }

  openHostEditor();
});

socket.on("host:passwordSet", r => {
  if (!r.ok) {
    return alert(r.message);
  }

  openHostEditor();
});

function openHostEditor() {
  role = "host";
  socket.emit("host:getQuiz");
}

/* =========================
   HOST QUIZ EDITOR
========================= */

socket.on("host:quiz", quiz => {
  hostTitle =
    quiz.title ||
    "우리들의 퀴즈쇼";

  hostQuestions =
    quiz.questions?.length
      ? quiz.questions
      : JSON.parse(JSON.stringify(sample));

  hostSetup();
});

socket.on("host:saved", () => {
  const b = document.getElementById("saveState");

  if (b) {
    b.textContent = "저장됨 ✓";
  }
});

function hostSetup() {
  app.innerHTML = `
    <div class="wrap">
      <div class="card">

        <div class="top">
          <div>
            <h1>진행자 설정</h1>
            <span class="badge">/host</span>
          </div>

          <span
            id="saveState"
            class="muted"
          >
            DB에 자동 저장
          </span>
        </div>

        <label>퀴즈 제목</label>

        <input
          id="title"
          value="${esc(hostTitle)}"
        >

        <div id="editor"></div>

        <div class="top">

          <button
            class="primary"
            onclick="addQ()"
          >
            문제 추가
          </button>

          <button
            class="green"
            onclick="createRoom()"
          >
            새 방 만들기
          </button>

        </div>

        <hr>

        <h2>기존 방 불러오기</h2>

        <p class="muted">
          Render가 재시작되어도 저장된 방의 코드를 입력하면
          기존 방을 다시 불러올 수 있습니다.
        </p>

        <div class="top">

          <input
            id="loadRoomCode"
            placeholder="기존 방 코드"
            maxlength="6"
            style="text-transform:uppercase;"
          >

          <button
            class="gray"
            onclick="loadExistingRoom()"
          >
            기존 방 불러오기
          </button>

        </div>

      </div>
    </div>
  `;

  renderEditor();
}

function renderEditor() {
  const ed = document.getElementById("editor");

  if (!ed) return;

  ed.innerHTML = "";

  hostQuestions.forEach((q, i) => {

    const d = document.createElement("div");

    d.className = "qrow";

    d.innerHTML = `
      <div class="top">
        <b>Q${i + 1}</b>

        <button
          class="danger"
          onclick="delQ(${i})"
        >
          삭제
        </button>
      </div>

      <label>문제</label>

      <textarea data-k="question">${esc(q.question)}</textarea>

      <div class="grid">

        <div>
          <label>유형</label>

          <select data-k="type">
            <option
              value="single"
              ${q.type === "single" ? "selected" : ""}
            >
              1,2,3,4
            </option>

            <option
              value="ox"
              ${q.type === "ox" ? "selected" : ""}
            >
              O / X
            </option>

            <option
              value="ab"
              ${q.type === "ab" ? "selected" : ""}
            >
              A / B
            </option>
          </select>
        </div>

        <div>
          <label>점수</label>

          <input
            type="number"
            data-k="points"
            value="${Number(q.points) || 0}"
          >
        </div>

      </div>

      <div class="grid options-edit">

        ${(q.options || [])
          .map(
            (o, j) => `
              <div>
                <label>보기 ${esc(o.value)}</label>

                <input
                  data-opt="${j}"
                  value="${esc(o.label)}"
                >
              </div>
            `
          )
          .join("")}

      </div>

      <label>정답</label>

      <select data-k="answer">

        ${(q.options || [])
          .map(
            o => `
              <option
                value="${esc(o.value)}"
                ${q.answer === o.value ? "selected" : ""}
              >
                ${esc(o.value)} · ${esc(o.label)}
              </option>
            `
          )
          .join("")}

      </select>
    `;

    d.querySelector('[data-k="type"]').onchange = () => {

      q.type =
        d.querySelector('[data-k="type"]').value;

      q.options =
        makeOptions(q.type);

      q.answer =
        q.options[0].value;

      renderEditor();

      saveQuiz();
    };

    d
      .querySelectorAll(
        "[data-k]:not([data-k=type])"
      )
      .forEach(x => {

        x.onchange = () => {
          updateQ(q, d);
        };

      });

    d
      .querySelectorAll("[data-opt]")
      .forEach(x => {

        x.oninput = () => {

          q.options[
            Number(x.dataset.opt)
          ].label = x.value;

          saveQuiz();
        };

      });

    ed.appendChild(d);
  });
}

function updateQ(q, d) {

  q.question =
    d.querySelector(
      '[data-k="question"]'
    ).value;

  q.points =
    Number(
      d.querySelector(
        '[data-k="points"]'
      ).value
    ) || 0;

  q.answer =
    d.querySelector(
      '[data-k="answer"]'
    ).value;

  saveQuiz();
}

function saveQuiz() {

  hostTitle =
    document.getElementById("title")?.value ||
    hostTitle;

  socket.emit(
    "host:saveQuiz",
    {
      title: hostTitle,
      questions: hostQuestions
    }
  );
}

function delQ(i) {

  hostQuestions.splice(i, 1);

  renderEditor();

  saveQuiz();
}

function addQ() {

  hostQuestions.push({
    id: "q" + Date.now(),
    type: "single",
    question: "새 문제",
    options: makeOptions("single"),
    answer: "1",
    points: 10
  });

  renderEditor();

  saveQuiz();
}

/* =========================
   CREATE NEW ROOM
========================= */

function createRoom() {

  saveQuiz();

  socket.emit(
    "host:create",
    {
      title: hostTitle,
      questions: hostQuestions
    }
  );
}

socket.on("host:created", ({ code }) => {

  state = null;

  loadedRoomCode = code;

  hostPage(code);
});

/* =========================
   LOAD EXISTING ROOM
========================= */

function loadExistingRoom() {

  const input =
    document.getElementById(
      "loadRoomCode"
    );

  if (!input) return;

  const code =
    input.value
      .trim()
      .toUpperCase();

  if (!code) {
    return alert("방 코드를 입력해주세요.");
  }

  loadedRoomCode = code;

  socket.emit(
    "host:load",
    {
      code
    }
  );
}

socket.on("host:ok", () => {

  /*
    host:load 직후 서버에서 state를
    다시 보내므로 여기서는 기존 코드만
    임시로 사용한다.
  */

  if (loadedRoomCode) {
    hostPage(loadedRoomCode);
  }
});

/* =========================
   HOST PAGE
========================= */

function hostPage(code) {

  role = "host";

  app.innerHTML = `
    <div class="wrap">

      <div class="card">

        <div class="top">

          <div>
            <h1>진행자 화면</h1>

            <span class="badge">
              방 코드:
              <b>${esc(code)}</b>
            </span>
          </div>

          <button
            class="gray"
            onclick="hostSetup()"
          >
            설정
          </button>

        </div>

        <div id="hostMain"></div>

      </div>

    </div>
  `;

  /*
    DB에서 불러온 방의 state가
    아직 도착하지 않았을 수도 있으므로
    state가 있을 때만 렌더링한다.
  */

  renderHost();
}

function renderHost() {

  if (!state) return;

  const q =
    state.questions[state.current];

  if (!q) return;

  const main =
    document.getElementById("hostMain");

  if (!main) return;

  main.innerHTML = `
    <h2>
      Q${state.current + 1}.
      ${esc(q.question)}
    </h2>

    <p>
      문제 점수:
      <b>${q.points}</b>점
      · 상태:
      ${
        state.revealed
          ? "정답 공개됨"
          : state.locked
            ? "잠금"
            : "답변 가능"
      }
    </p>

    <div class="options">

      ${q.options
        .map(
          o => `
            <div class="card">
```
