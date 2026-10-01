const socket = io();
const app = document.getElementById("app");

let state = null;
let role = null;
let myAnswer = null;
let myName = "";
let hostQuestions = [];
let hostTitle = "우리들의 퀴즈쇼";

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
      '"': "&quot;",
      "'": "&#39;"
    }[m])
  );
}

function labels(type) {
  if (type === "ox") return ["O", "X"];
  if (type === "ab") return ["A", "B"];
  return ["1", "2", "3", "4"];
}

function makeOptions(type) {
  return labels(type).map(v => ({
    value: v,
    label: v
  }));
}

/* =========================
   진행자 로그인
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

          <button class="primary" onclick="loginHost()">
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

          <button class="primary" onclick="setupHost()">
            비밀번호 설정
          </button>
        </div>
      </div>
    `;
  }
});

function loginHost() {
  const pw = document.getElementById("pw").value;
  socket.emit("host:login", pw);
}

function setupHost() {
  const a = document.getElementById("pw").value;
  const b = document.getElementById("pw2").value;

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

/* =========================
   퀴즈 불러오기
========================= */

function openHostEditor() {
  role = "host";
  socket.emit("host:getQuiz");
}

socket.on("host:quiz", quiz => {
  hostTitle = quiz.title || "우리들의 퀴즈쇼";

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

/* =========================
   진행자 설정 / 문제 편집
========================= */

function hostSetup() {
  app.innerHTML = `
    <div class="wrap">
      <div class="card">

        <div class="top">
          <div>
            <h1>진행자 설정</h1>
            <span class="badge">/host</span>
          </div>

          <span id="saveState" class="muted">
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
          <button class="primary" onclick="addQ()">
            문제 추가
          </button>

          <button class="green" onclick="createRoom()">
            새 방 만들기
          </button>
        </div>

        <hr>

        <h2>기존 방 불러오기</h2>

        <p class="muted">
          이미 만들어진 방의 코드를 입력하면
          해당 방의 진행자로 다시 들어갑니다.
        </p>

        <div class="top">
          <input
            id="loadCode"
            placeholder="방 코드"
            maxlength="6"
            style="text-transform:uppercase"
          >

          <button
            class="primary"
            onclick="loadRoom()"
          >
            기존 방 불러오기
          </button>
        </div>

      </div>
    </div>
  `;

  renderEditor();
}

/* =========================
   문제 편집기
========================= */

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
              1, 2, 3, 4
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
                ${q.type==="ox" ? esc(o.label) : `${esc(o.value)} · ${esc(o.label)}`}
              </option>
            `
          )
          .join("")}

      </select>
    `;

    const typeSelect = d.querySelector('[data-k="type"]');

    typeSelect.onchange = () => {
      q.type = typeSelect.value;
      q.options = makeOptions(q.type);
      q.answer = q.options[0].value;

      renderEditor();
      saveQuiz();
    };

    d
      .querySelectorAll('[data-k]:not([data-k="type"])')
      .forEach(x => {
        x.onchange = () => updateQ(q, d);
      });

    d.querySelectorAll("[data-opt]").forEach(x => {
      x.oninput = () => {
        q.options[Number(x.dataset.opt)].label = x.value;
        saveQuiz();
      };
    });

    ed.appendChild(d);
  });
}

function updateQ(q, d) {
  q.question =
    d.querySelector('[data-k="question"]').value;

  q.points =
    Number(
      d.querySelector('[data-k="points"]').value
    ) || 0;

  q.answer =
    d.querySelector('[data-k="answer"]').value;

  saveQuiz();
}

/* =========================
   퀴즈 저장
========================= */

function saveQuiz() {
  hostTitle =
    document.getElementById("title")?.value ||
    hostTitle;

  socket.emit("host:saveQuiz", {
    title: hostTitle,
    questions: hostQuestions
  });

  /*
    현재 이미 방에 들어와 있는 상태라면
    수정한 문제를 현재 방에도 바로 반영
  */
  if (state?.code) {
    socket.emit(
      "host:updateQuestions",
      hostQuestions
    );
  }
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
   새 방 만들기
========================= */

function createRoom() {
  hostTitle =
    document.getElementById("title")?.value ||
    hostTitle;

  saveQuiz();

  socket.emit("host:create", {
    title: hostTitle,
    questions: hostQuestions
  });
}

socket.on("host:created", ({ code }) => {
  hostPage(code);
});

/* =========================
   기존 방 불러오기
========================= */

function loadRoom() {
  const input = document.getElementById("loadCode");

  if (!input) return;

  const code = input.value.trim().toUpperCase();

  if (!code) {
    return alert("방 코드를 입력해주세요.");
  }

  socket.emit("host:load", {
    code
  });
}

/*
  서버가 host:ok를 먼저 보내고
  state를 그 다음에 보내기 때문에
  여기서 바로 hostPage()를 실행하지 않는다.

  실제 방 정보는 state 이벤트에서 받은 뒤 화면을 만든다.
*/
socket.on("host:ok", () => {
  role = "host";
});

/* =========================
   진행자 화면
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
              <b>${esc(o.value)}</b>
              ·
              ${esc(o.label)}

              ${
                state.revealed &&
                o.value === q.answer
                  ? " ← 정답"
                  : ""
              }
            </div>
          `
        )
        .join("")}

    </div>

    <div class="top">

      <button
        class="gray"
        onclick="prevQ()"
      >
        이전
      </button>

      <button
        class="danger"
        onclick="toggleLock()"
      >
        ${
          state.locked
            ? "답변 재개"
            : "답변 잠금"
        }
      </button>

      <button
        class="green"
        onclick="reveal()"
      >
        정답 공개
      </button>

      <button
        class="primary"
        onclick="nextQ()"
      >
        다음 문제
      </button>

    </div>

    <div class="card">

      <h2>
        참가자 (${state.participants.length})
      </h2>

      <table>

        <tr>
          <th>이름</th>
          <th>현재 답</th>
          <th>점수</th>
        </tr>

        ${state.participants
          .slice()
          .sort(
            (a, b) =>
              b.score - a.score
          )
          .map(
            p => `
              <tr>
                <td>${esc(p.name)}</td>
                <td>${esc(p.answer || "미응답")}</td>
                <td class="score">
                  ${p.score}
                </td>
              </tr>
            `
          )
          .join("")}

      </table>

      <button
        class="gray"
        onclick="resetScores()"
      >
        점수 초기화
      </button>

    </div>
  `;
}

/* =========================
   진행자 문제 조작
========================= */

function toggleLock() {
  socket.emit(
    state.locked
      ? "host:unlock"
      : "host:lock"
  );
}

function reveal() {
  socket.emit("host:reveal");
}

function nextQ() {
  socket.emit("host:next");
}

function prevQ() {
  socket.emit("host:prev");
}

function resetScores() {
  if (
    confirm(
      "모든 참가자의 점수를 0점으로 초기화할까요?"
    )
  ) {
    socket.emit("host:resetScores");
  }
}

/* =========================
   참가자
========================= */

function joinPage() {
  app.innerHTML = `
    <div class="wrap">

      <div class="card">

        <h1>QuizShow 참가</h1>

        <p class="muted">
          진행자가 알려준 방 코드와 이름을 입력하세요.
        </p>

        <input
          id="code"
          placeholder="방 코드"
        >

        <input
          id="name"
          placeholder="이름"
        >

        <button
          class="primary"
          onclick="join()"
        >
          입장
        </button>

      </div>

    </div>
  `;
}

function join() {
  const code =
    document.getElementById("code")
      .value
      .trim()
      .toUpperCase();

  const name =
    document.getElementById("name")
      .value
      .trim();

  if (!code) {
    return alert("방 코드를 입력해주세요.");
  }

  if (!name) {
    return alert("이름을 입력해주세요.");
  }

  myName = name;

  socket.emit("join", {
    code,
    name
  });
}

socket.on("joined", x => {
  myName = x.name;
  role = "player";
  renderPlayer();
});

/* =========================
   실시간 상태
========================= */

socket.on("state", s => {
  state = s;

  if (role === "host") {
    /*
      기존 방 불러오기 또는 새 방 생성 후
      서버에서 state가 도착하면 진행자 화면 표시
    */
    hostPage(state.code);
  }

  else if (role === "player") {
    renderPlayer();
  }
});

socket.on("errorMsg", m => {
  alert(m);
});

/* =========================
   참가자 화면
========================= */

function renderPlayer() {
  if (!state) return;

  const q =
    state.questions[state.current];

  if (!q) return;

  const me =
    state.participants.find(
      p => p.name === myName
    );

  myAnswer =
    me?.answer || null;

  let result = "";

  if (state.revealed && myAnswer) {
    if (myAnswer === q.answer) {
      result = `
        <div class="answerMark correct"></div>
        <h2 class="correct">
          정답입니다!
        </h2>
      `;
    } else {
      result = `
        <div class="answerMark wrong">
          ✕
        </div>

        <h2 class="wrong">
          오답입니다.
        </h2>
      `;
    }
  }

  app.innerHTML = `
    <div class="wrap">

      <div class="card">

        <div class="top">

          <span class="badge">
            Q${state.current + 1}
          </span>

          <span class="score">
            내 점수:
            ${me?.score || 0}
          </span>

        </div>

        <h1>
          ${esc(q.question)}
        </h1>

        <div class="options">

          ${q.options
            .map(
              o => `
                <button
                  class="opt ${
                    myAnswer === o.value
                      ? "selected"
                      : ""
                  }"
                  ${
                    state.locked ||
                    state.revealed
                      ? "disabled"
                      : ""
                  }
                  onclick="answer('${esc(o.value)}')"
                >
                  ${esc(o.value)}
                  ·
                  ${esc(o.label)}
                </button>
              `
            )
            .join("")}

        </div>

        <p class="muted">

          ${
            myAnswer
              ? `내가 선택한 답:
                 ${esc(myAnswer)}`
              : state.locked
              ? "답변이 잠겼습니다."
              : "답을 선택해주세요."
          }

        </p>

        ${result}

      </div>

    </div>
  `;
}

function answer(v) {
  socket.emit("answer", v);
}

/* =========================
   페이지 시작
========================= */

if (
  location.pathname.startsWith("/host")
) {
  hostLogin();
} else {
  joinPage();
}
