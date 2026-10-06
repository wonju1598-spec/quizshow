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
   정답 종류 판별
========================= */

// 보기 없음
function isNoOptionAnswer(answer) {
  return String(answer || "").startsWith("__NO_OPTION__|");
}

// 모든 보기 정답
function isAllOptionsAnswer(answer) {
  return String(answer || "") === "__ALL_OPTIONS__";
}

// 참가자의 답이 정답인지 판별
function isAnswerCorrect(q, answer) {
  if (!q || !answer) return false;

  // 모든 보기가 정답인 경우
  if (isAllOptionsAnswer(q.answer)) {
    return true;
  }

  // 보기 없음은 어떤 보기든 오답
  if (isNoOptionAnswer(q.answer)) {
    return false;
  }

  // 일반 정답
  return answer === q.answer;
}

// 보기 없음의 실제 정답 가져오기
function getNoOptionCorrectAnswer(answer) {
  if (!isNoOptionAnswer(answer)) return "";

  return String(answer).slice(
    "__NO_OPTION__|".length
  );
}

// 정답 공개 화면에 표시할 정답
function getDisplayAnswer(q) {
  if (!q) return "";

  if (isAllOptionsAnswer(q.answer)) {
    return "모든 보기";
  }

  if (isNoOptionAnswer(q.answer)) {
    return getNoOptionCorrectAnswer(q.answer);
  }

  return q.answer || "";
}

/* =========================
   COMMON SOCKET ERRORS
========================= */

socket.on("errorMsg", message => {
  alert(message || "오류가 발생했습니다.");
});

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
  const pw =
    document.getElementById("pw")?.value || "";

  socket.emit("host:login", pw);
}

function setupHost() {
  const a =
    document.getElementById("pw")?.value || "";

  const b =
    document.getElementById("pw2")?.value || "";

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

socket.on("host:createPasswordResult", r => {
  if (!r.ok) {
    return alert(r.message);
  }

  alert(
    "새 진행자 비밀번호가 만들어졌습니다.\n\n" +
    "이 비밀번호로 로그인하면 기존 퀴즈와 완전히 분리된 새 퀴즈를 만들 수 있습니다."
  );

  const a =
    document.getElementById("newHostPw");

  const b =
    document.getElementById("newHostPw2");

  if (a) a.value = "";
  if (b) b.value = "";
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
      : JSON.parse(
          JSON.stringify(sample)
        );

  hostSetup();
});

socket.on("host:saved", () => {
  const b =
    document.getElementById("saveState");

  if (b) {
    b.textContent = "저장됨 ✓";

    setTimeout(() => {
      if (b) {
        b.textContent =
          "DB에 자동 저장";
      }
    }, 1200);
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

        <hr>

        <h2>새 진행자 비밀번호 만들기</h2>

        <p class="muted">
          새 비밀번호로 로그인하면 현재 퀴즈와 분리된 별도의 퀴즈 공간을 사용합니다.
          기존 퀴즈는 수정되지 않습니다.
        </p>

        <input
          id="newHostPw"
          type="password"
          placeholder="새 비밀번호 (4자 이상)"
        >

        <input
          id="newHostPw2"
          type="password"
          placeholder="새 비밀번호 다시 입력"
        >

        <button
          class="primary wide"
          onclick="createNewHostPassword()"
        >
          새 비밀번호 추가
        </button>

      </div>
    </div>
  `;

  renderEditor();
}

function renderEditor() {
  const ed =
    document.getElementById("editor");

  if (!ed) return;

  ed.innerHTML = "";

  hostQuestions.forEach((q, i) => {
    const d =
      document.createElement("div");

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
              ${q.type === "single"
                ? "selected"
                : ""}
            >
              1,2,3,4
            </option>

            <option
              value="ox"
              ${q.type === "ox"
                ? "selected"
                : ""}
            >
              O / X
            </option>

            <option
              value="ab"
              ${q.type === "ab"
                ? "selected"
                : ""}
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
                ${q.answer === o.value
                  ? "selected"
                  : ""}
              >
                ${esc(o.value)} ·
                ${esc(o.label)}
              </option>
            `
          )
          .join("")}

        <option
          value="__ALL_OPTIONS__"
          ${isAllOptionsAnswer(q.answer)
            ? "selected"
            : ""}
        >
          모든 보기 정답
        </option>

        <option
          value="__NO_OPTION__"
          ${isNoOptionAnswer(q.answer)
            ? "selected"
            : ""}
        >
          보기 없음
        </option>

      </select>

      <div
        class="no-option-answer"
        style="${
          isNoOptionAnswer(q.answer)
            ? "display:block;"
            : "display:none;"
        } margin-top:8px;"
      >

        <label>실제 정답</label>

        <input
          data-k="noOptionAnswer"
          value="${esc(
            getNoOptionCorrectAnswer(
              q.answer
            )
          )}"
          placeholder="보기에는 없는 실제 정답을 입력하세요"
        >

        <p
          class="muted"
          style="margin-top:6px;"
        >
          참가자는 보기 중 하나를 선택하지만,
          어떤 보기를 선택해도 오답 처리됩니다.
        </p>

      </div>
    `;

    const typeSelect =
      d.querySelector(
        '[data-k="type"]'
      );

    if (typeSelect) {
      typeSelect.onchange = () => {
        q.type = typeSelect.value;
        q.options =
          makeOptions(q.type);

        q.answer =
          q.options[0].value;

        renderEditor();
        saveQuiz();
      };
    }

    d
      .querySelectorAll(
        "[data-k]:not([data-k=type])"
      )
      .forEach(x => {
        x.onchange = () => {

          if (x.dataset.k === "answer") {

            // 모든 보기 정답
            if (
              x.value ===
              "__ALL_OPTIONS__"
            ) {
              q.answer =
                "__ALL_OPTIONS__";

              renderEditor();
              saveQuiz();
              return;
            }

            // 보기 없음
            if (
              x.value ===
              "__NO_OPTION__"
            ) {
              const actual =
                getNoOptionCorrectAnswer(
                  q.answer
                );

              q.answer =
                "__NO_OPTION__|" +
                actual;

              renderEditor();
              saveQuiz();
              return;
            }

            // 일반 정답
            q.answer =
              x.value;

            saveQuiz();
            renderEditor();

            return;
          }

          updateQ(q, d);
        };
      });

    const noOptionInput =
      d.querySelector(
        '[data-k="noOptionAnswer"]'
      );

    if (noOptionInput) {
      noOptionInput.oninput = () => {
        q.answer =
          "__NO_OPTION__|" +
          noOptionInput.value;

        saveQuiz();
      };
    }

    d
      .querySelectorAll(
        "[data-opt]"
      )
      .forEach(x => {
        x.oninput = () => {
          const index =
            Number(x.dataset.opt);

          if (q.options[index]) {
            q.options[index].label =
              x.value;

            saveQuiz();
          }
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

  const answerSelect =
    d.querySelector(
      '[data-k="answer"]'
    );

  if (answerSelect) {

    if (
      answerSelect.value ===
      "__ALL_OPTIONS__"
    ) {
      q.answer =
        "__ALL_OPTIONS__";

    } else if (
      answerSelect.value ===
      "__NO_OPTION__"
    ) {
      const actual =
        d.querySelector(
          '[data-k="noOptionAnswer"]'
        )?.value ||
        getNoOptionCorrectAnswer(
          q.answer
        );

      q.answer =
        "__NO_OPTION__|" +
        actual;

    } else {
      q.answer =
        answerSelect.value;
    }
  }

  saveQuiz();
}

function saveQuiz() {
  hostTitle =
    document.getElementById(
      "title"
    )?.value ||
    hostTitle;

  socket.emit(
    "host:saveQuiz",
    {
      title: hostTitle,
      questions:
        hostQuestions
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
    id:
      "q" +
      Date.now(),

    type: "single",

    question:
      "새 문제",

    options:
      makeOptions("single"),

    answer: "1",

    points: 10
  });

  renderEditor();
  saveQuiz();
}

/* =========================
   CREATE ROOM
========================= */

function createRoom() {
  saveQuiz();

  socket.emit(
    "host:create",
    {
      title: hostTitle,
      questions:
        hostQuestions
    }
  );
}

socket.on(
  "host:created",
  ({ code }) => {
    loadedRoomCode = code;
    role = "host";
    hostPage(code);
  }
);

/* =========================
   LOAD EXISTING ROOM
========================= */

function createNewHostPassword() {
  const a =
    document.getElementById(
      "newHostPw"
    )?.value || "";

  const b =
    document.getElementById(
      "newHostPw2"
    )?.value || "";

  if (a.length < 4) {
    return alert(
      "새 비밀번호는 4자 이상으로 설정해주세요."
    );
  }

  if (a !== b) {
    return alert(
      "새 비밀번호가 서로 다릅니다."
    );
  }

  socket.emit(
    "host:createPassword",
    a
  );
}

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
    return alert(
      "방 코드를 입력해주세요."
    );
  }

  loadedRoomCode = code;

  socket.emit(
    "host:load",
    {
      code
    }
  );
}

socket.on(
  "host:ok",
  ({ code }) => {
    loadedRoomCode =
      code ||
      loadedRoomCode;

    hostPage(
      loadedRoomCode
    );
  }
);

/* =========================
   ROOM STATE
========================= */

let lastQuestionIndex = null;

socket.on("state", s => {
  const changedQuestion =
    lastQuestionIndex !== null &&
    lastQuestionIndex !==
      s.current;

  state = s;
  lastQuestionIndex =
    s.current;

  if (changedQuestion) {
    myAnswer = null;
  }

  if (role === "host") {
    renderHost();
  }

  if (role === "player") {
    renderPlayer();
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

  renderHost();
}

function renderHost() {
  const main =
    document.getElementById(
      "hostMain"
    );

  if (!main) return;

  if (!state) {
    main.innerHTML = `
      <p class="muted">
        방 정보를 불러오는 중입니다...
      </p>
    `;

    return;
  }

  const q =
    state.questions[
      state.current
    ];

  if (!q) {
    main.innerHTML = `
      <p class="muted">
        등록된 문제가 없습니다.
      </p>
    `;

    return;
  }

  main.innerHTML = `
    <h2>
      Q${state.current + 1}.
      ${esc(q.question)}
    </h2>

    <p>
      문제 점수:
      <b>
        ${Number(q.points) || 0}
      </b>점
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
              <span>
                ${esc(o.label)}
              </span>
            </div>
          `
        )
        .join("")}

    </div>

    <div class="top">

      <button
        class="primary"
        onclick="prevQuestion()"
        ${
          state.current <= 0
            ? "disabled"
            : ""
        }
      >
        이전 문제
      </button>

      <button
        class="primary"
        onclick="nextQuestion()"
        ${
          state.current >=
          state.questions.length - 1
            ? "disabled"
            : ""
        }
      >
        다음 문제
      </button>

      ${
        state.locked
          ? `
            <button
              class="green"
              onclick="unlockQuestion()"
            >
              답변 열기
            </button>
          `
          : `
            <button
              class="gray"
              onclick="lockQuestion()"
            >
              답변 잠그기
            </button>
          `
      }

      <button
        class="green"
        onclick="revealAnswer()"
        ${
          state.revealed
            ? "disabled"
            : ""
        }
      >
        정답 공개
      </button>

      <button
        class="danger"
        onclick="resetScores()"
      >
        점수 초기화
      </button>

    </div>

    <hr>

    <h3>참가자</h3>

    <div id="players"></div>
  `;

  renderPlayers();
}

function renderPlayers() {
  const el =
    document.getElementById(
      "players"
    );

  if (!el) return;

  const players =
    Array.isArray(
      state?.participants
    )
      ? [
          ...state.participants
        ]
      : [];

  if (!players.length) {
    el.innerHTML = `
      <p class="muted">
        아직 참가자가 없습니다.
      </p>
    `;

    return;
  }

  players.sort(
    (a, b) =>
      (Number(b.score) || 0) -
      (Number(a.score) || 0)
  );

  el.innerHTML =
    players
      .map(
        p => `
          <div class="card">
            <b>
              ${esc(p.name)}
            </b>

            <span>
              ${Number(p.score) || 0}점

              ${
                p.answer
                  ? `
                    · 답변:
                    ${esc(p.answer)}
                  `
                  : ""
              }
            </span>
          </div>
        `
      )
      .join("");
}

function nextQuestion() {
  socket.emit(
    "host:next"
  );
}

function prevQuestion() {
  socket.emit(
    "host:prev"
  );
}

function lockQuestion() {
  socket.emit(
    "host:lock"
  );
}

function unlockQuestion() {
  socket.emit(
    "host:unlock"
  );
}

function revealAnswer() {
  socket.emit(
    "host:reveal"
  );
}

function resetScores() {
  if (
    confirm(
      "모든 참가자의 점수를 0점으로 초기화할까요?"
    )
  ) {
    socket.emit(
      "host:resetScores"
    );
  }
}

/* =========================
   PLAYER JOIN
========================= */

function openJoin() {
  role = "player";
  renderJoin();
}

function renderJoin() {
  app.innerHTML = `
    <div class="wrap">
      <div class="card auth">

        <h1>퀴즈 참가</h1>

        <input
          id="roomCode"
          placeholder="방 코드"
          maxlength="6"
          style="text-transform:uppercase;"
        >

        <input
          id="playerName"
          placeholder="이름"
          maxlength="20"
        >

        <button
          class="primary"
          onclick="joinRoom()"
        >
          참가하기
        </button>

      </div>
    </div>
  `;
}

function joinRoom() {
  const code =
    document.getElementById(
      "roomCode"
    )?.value
      .trim()
      .toUpperCase();

  const name =
    document.getElementById(
      "playerName"
    )?.value
      .trim();

  if (!code) {
    return alert(
      "방 코드를 입력해주세요."
    );
  }

  if (!name) {
    return alert(
      "이름을 입력해주세요."
    );
  }

  myName = name;

  socket.emit(
    "join",
    {
      code,
      name
    }
  );
}

socket.on(
  "joined",
  ({ code, name }) => {
    role = "player";
    myName =
      name || myName;

    loadedRoomCode = code;
    myAnswer = null;

    app.innerHTML = `
      <div class="wrap">
        <div class="card">
          <p class="muted">
            방에 참가했습니다.
            퀴즈가 시작되면 문제가 표시됩니다.
          </p>
        </div>
      </div>
    `;
  }
);

function renderPlayer() {
  if (!state) return;

  const q =
    state.questions[
      state.current
    ];

  if (!q) {
    app.innerHTML = `
      <div class="wrap">
        <div class="card">
          <h1>퀴즈 준비 중</h1>

          <p class="muted">
            진행자가 문제를 준비하고 있습니다.
          </p>
        </div>
      </div>
    `;

    return;
  }

  const me =
    Array.isArray(
      state.participants
    )
      ? state.participants.find(
          p =>
            p.id ===
            socket.id
        )
      : null;

  const score =
    Number(me?.score) || 0;

  const serverAnswer =
    me?.answer || null;

  if (serverAnswer) {
    myAnswer =
      serverAnswer;
  }

  app.innerHTML = `
    <div class="wrap">

      <div class="card">

        <div class="top">

          <div>

            <h1>
              ${esc(
                state.title ||
                "우리들의 퀴즈쇼"
              )}
            </h1>

            <span class="badge">
              ${esc(myName)}
            </span>

          </div>

          <span class="badge">
            ${score}점
          </span>

        </div>

        <h2>
          Q${state.current + 1}.
          ${esc(q.question)}
        </h2>

        ${
          state.revealed
            ? `
              <div class="card">

                <b>정답</b>

                <p>
                  ${esc(
                    getDisplayAnswer(q)
                  )}
                </p>

                ${
                  isAnswerCorrect(
                    q,
                    myAnswer
                  )
                    ? `
                      <p>
                        정답입니다!
                        +${
                          Number(
                            q.points
                          ) || 0
                        }점
                      </p>
                    `
                    : myAnswer
                      ? `
                        <p>
                          오답입니다.
                        </p>
                      `
                      : ""
                }

              </div>
            `
            : state.locked
              ? `
                <p class="muted">
                  답변이 잠겼습니다.
                </p>

                ${
                  myAnswer
                    ? `
                      <p>
                        제출한 답:
                        <b>
                          ${esc(myAnswer)}
                        </b>
                      </p>
                    `
                    : ""
                }
              `
              : `
                <div class="options">

                  ${q.options
                    .map(
                      o => `
                        <button
                          class="option"
                          onclick="answerQuestion('${esc(
                            o.value
                          )}')"
                          ${
                            myAnswer
                              ? "disabled"
                              : ""
                          }
                        >
                          <b>
                            ${esc(
                              o.value
                            )}
                          </b>

                          ${esc(
                            o.label
                          )}
                        </button>
                      `
                    )
                    .join("")}

                </div>

                ${
                  myAnswer
                    ? `
                      <p class="muted">
                        제출한 답:
                        <b>
                          ${esc(
                            myAnswer
                          )}
                        </b>
                      </p>
                    `
                    : ""
                }
              `
        }

      </div>

    </div>
  `;
}

function answerQuestion(answer) {
  if (myAnswer) return;

  if (
    state?.locked ||
    state?.revealed
  ) {
    return;
  }

  const q =
    state?.questions?.[
      state.current
    ];

  if (!q) return;

  if (
    !q.options.some(
      o =>
        o.value ===
        answer
    )
  ) {
    return;
  }

  myAnswer = answer;

  socket.emit(
    "answer",
    answer
  );

  renderPlayer();
}

/* =========================
   BOOT
========================= */

function boot() {
  const path =
    window.location.pathname;

  if (path === "/host") {
    hostLogin();
    return;
  }

  if (path === "/join") {
    openJoin();
    return;
  }

  app.innerHTML = `
    <div class="wrap">
      <div class="card auth">

        <h1>
          우리들의 퀴즈쇼
        </h1>

        <p class="muted">
          진행자는 /host,
          참가자는 /join으로 접속하세요.
        </p>

        <div class="top">

          <button
            class="primary"
            onclick="location.href='/host'"
          >
            진행자
          </button>

          <button
            class="green"
            onclick="location.href='/join'"
          >
            참가자
          </button>

        </div>

      </div>
    </div>
  `;
}

boot();
