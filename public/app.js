
const socket=io();
const app=document.getElementById("app");
let state=null, role=null, myAnswer=null, myName="";

const sample=[
 {id:"q1",type:"single",question:"대한민국의 수도는?",options:[{value:"1",label:"서울"},{value:"2",label:"부산"},{value:"3",label:"대구"},{value:"4",label:"인천"}],answer:"1",points:10},
 {id:"q2",type:"ox",question:"지구는 태양 주위를 돈다.",options:[{value:"O",label:"O"},{value:"X",label:"X"}],answer:"O",points:20},
 {id:"q3",type:"ab",question:"HTML은 프로그래밍 언어이다.",options:[{value:"A",label:"맞다"},{value:"B",label:"아니다"}],answer:"B",points:30}
];

function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
function saveLocal(qs){localStorage.setItem("quizQuestions",JSON.stringify(qs));}
function loadLocal(){try{return JSON.parse(localStorage.getItem("quizQuestions"))||sample}catch{return sample}}

function home(){
 app.innerHTML=`<div class="wrap"><div class="card"><h1>QuizShow</h1><p class="muted">진행자와 참가자가 같은 링크에서 실시간으로 참여합니다.</p>
 <div class="grid"><button class="primary" onclick="hostSetup()">진행자</button><button class="gray" onclick="joinPage()">참가자</button></div></div></div>`;
}
function hostSetup(){
 const qs=loadLocal();
 app.innerHTML=`<div class="wrap"><div class="card"><div class="top"><h1>진행자 설정</h1><button class="gray" onclick="home()">처음으로</button></div>
 <label>퀴즈 제목</label><input id="title" value="우리들의 퀴즈쇼">
 <div id="editor"></div><div class="top"><button class="primary" onclick="addQ()">문제 추가</button><button class="green" onclick="createRoom()">방 만들기</button></div></div></div>`;
 renderEditor(qs);
}
function renderEditor(qs){
 const ed=document.getElementById("editor"); ed.innerHTML="";
 qs.forEach((q,i)=>{
   const d=document.createElement("div"); d.className="qrow"; d.innerHTML=`<div class="top"><b>Q${i+1}</b><button class="danger" onclick="delQ(${i})">삭제</button></div>
   <label>문제</label><textarea data-k="question">${esc(q.question)}</textarea>
   <div class="grid"><div><label>유형</label><select data-k="type"><option value="single" ${q.type==="single"?"selected":""}>1,2,3,4</option><option value="ox" ${q.type==="ox"?"selected":""}>O / X</option><option value="ab" ${q.type==="ab"?"selected":""}>A / B</option></select></div><div><label>점수</label><input type="number" data-k="points" value="${q.points||0}"></div></div>
   <div class="grid">${q.options.map((o,j)=>`<div><label>보기 ${j+1}</label><input data-opt="${j}" value="${esc(o.label)}"></div>`).join("")}</div>
   <label>정답</label><select data-k="answer">${q.options.map(o=>`<option value="${esc(o.value)}" ${q.answer===o.value?"selected":""}>${esc(o.label)}</option>`).join("")}</select>`;
   d.querySelectorAll("[data-k]").forEach(x=>x.onchange=()=>updateEditor(qs,i,d));
   d.querySelectorAll("[data-opt]").forEach(x=>x.onchange=()=>updateEditor(qs,i,d));
   ed.appendChild(d);
 });
}
function updateEditor(qs,i,d){
 const q=qs[i]; q.question=d.querySelector('[data-k="question"]').value; q.type=d.querySelector('[data-k="type"]').value; q.points=Number(d.querySelector('[data-k="points"]').value)||0;
 d.querySelectorAll("[data-opt]").forEach(x=>q.options[Number(x.dataset.opt)].label=x.value);
 const old=q.answer; q.answer=d.querySelector('[data-k="answer"]').value;
 const map={single:["1","2","3","4"],ox:["O","X"],ab:["A","B"]}; const vals=map[q.type];
 if(q.options.length!==vals.length){q.options=vals.map((v,j)=>({value:v,label:v}));q.answer=vals.includes(old)?old:vals[0];renderEditor(qs);}
 saveLocal(qs);
}
function delQ(i){const qs=loadLocal();qs.splice(i,1);saveLocal(qs);hostSetup()}
function addQ(){const qs=loadLocal();qs.push({id:"q"+Date.now(),type:"single",question:"새 문제",options:[{value:"1",label:"보기 1"},{value:"2",label:"보기 2"},{value:"3",label:"보기 3"},{value:"4",label:"보기 4"}],answer:"1",points:10});saveLocal(qs);hostSetup()}
function createRoom(){const qs=loadLocal();socket.emit("host:create",{title:document.getElementById("title").value,questions:qs})}
socket.on("host:created",({code})=>hostPage(code));
socket.on("host:ok",()=>hostPage(state?.code||""));
function hostPage(code){
 role="host"; app.innerHTML=`<div class="wrap"><div class="card"><div class="top"><div><h1>진행자 화면</h1><span class="badge">방 코드: <b>${esc(code)}</b></span></div><button class="gray" onclick="hostSetup()">설정</button></div>
 <div id="hostMain"></div></div></div>`; renderHost();
}
function renderHost(){
 if(!state)return;
 const q=state.questions[state.current]; if(!q)return;
 const main=document.getElementById("hostMain"); if(!main)return;
 main.innerHTML=`<h2>Q${state.current+1}. ${esc(q.question)}</h2><p>문제 점수: <b>${q.points}</b>점 · 상태: ${state.revealed?"정답 공개됨":state.locked?"잠금":"답변 가능"}</p>
 <div class="options">${q.options.map(o=>`<div class="card"><b>${esc(o.value)}</b> · ${esc(o.label)} ${state.revealed&&o.value===q.answer?" ← 정답":""}</div>`).join("")}</div>
 <div class="top"><button class="gray" onclick="prevQ()">이전</button><button class="danger" onclick="toggleLock()">${state.locked?"답변 재개":"답변 잠금"}</button><button class="green" onclick="reveal()">정답 공개</button><button class="primary" onclick="nextQ()">다음 문제</button></div>
 <div class="card"><h2>참가자 (${state.participants.length})</h2><table><tr><th>이름</th><th>현재 답</th><th>점수</th></tr>${state.participants.slice().sort((a,b)=>b.score-a.score).map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.answer||"미응답")}</td><td class="score">${p.score}</td></tr>`).join("")}</table><button class="gray" onclick="resetScores()">점수 초기화</button></div>`;
}
function toggleLock(){socket.emit(state.locked?"host:unlock":"host:lock")}
function reveal(){socket.emit("host:reveal")}
function nextQ(){socket.emit("host:next")}
function prevQ(){socket.emit("host:prev")}
function resetScores(){if(confirm("모든 참가자의 점수를 0점으로 초기화할까요?"))socket.emit("host:resetScores")}
function joinPage(){app.innerHTML=`<div class="wrap"><div class="card"><h1>참가자 입장</h1><input id="code" placeholder="방 코드"><input id="name" placeholder="이름"><button class="primary" onclick="join()">입장</button></div></div>`}
function join(){myName=document.getElementById("name").value;socket.emit("join",{code:document.getElementById("code").value,name:myName})}
socket.on("joined",x=>{myName=x.name;role="player";renderPlayer()});
socket.on("state",s=>{state=s;if(role==="host")renderHost();else if(role==="player")renderPlayer()});
socket.on("errorMsg",m=>alert(m));
function renderPlayer(){
 if(!state)return;
 const q=state.questions[state.current]; if(!q)return;
 const me=state.participants.find(p=>p.name===myName);
 myAnswer=me?.answer||null;
 let result="";
 if(state.revealed && myAnswer) result=myAnswer===q.answer?`<div class="answerMark correct">●</div><h2 class="correct">정답입니다!</h2>`:`<div class="answerMark wrong">✕</div><h2 class="wrong">오답입니다.</h2>`;
 app.innerHTML=`<div class="wrap"><div class="card"><div class="top"><span class="badge">Q${state.current+1}</span><span class="score">내 점수: ${me?.score||0}</span></div>
 <h1>${esc(q.question)}</h1><div class="options">${q.options.map(o=>`<button class="opt ${myAnswer===o.value?"selected":""}" ${state.locked||state.revealed?"disabled":""} onclick="answer('${o.value}')">${esc(o.label)}</button>`).join("")}</div>
 <p class="muted">${myAnswer?`내가 선택한 답: ${esc(myAnswer)}`:state.locked?"답변이 잠겼습니다.":"답을 선택해주세요."}</p>${result}</div></div>`;
}
function answer(v){socket.emit("answer",v)}
home();
