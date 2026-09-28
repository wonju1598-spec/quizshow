
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function code() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function cleanRoom(room) {
  return {
    code: room.code,
    title: room.title,
    questions: room.questions,
    current: room.current,
    locked: room.locked,
    revealed: room.revealed,
    participants: [...room.participants.values()].map(p => ({
      id:p.id, name:p.name, score:p.score, answer:p.answer
    }))
  };
}

function broadcast(room) {
  io.to(room.code).emit("state", cleanRoom(room));
}

io.on("connection", socket => {
  socket.on("host:create", ({title, questions}) => {
    let c = code();
    while(rooms.has(c)) c = code();
    const room = {
      code:c,
      title:title || "퀴즈쇼",
      questions:Array.isArray(questions) ? questions : [],
      current:0,
      locked:false,
      revealed:false,
      participants:new Map(),
      host:socket.id
    };
    rooms.set(c, room);
    socket.join(c);
    socket.data.room=c;
    socket.data.role="host";
    socket.emit("host:created", {code:c});
    broadcast(room);
  });

  socket.on("host:load", ({code:c}) => {
    const room=rooms.get(String(c||"").toUpperCase());
    if(!room) return socket.emit("errorMsg","존재하지 않는 방입니다.");
    room.host=socket.id;
    socket.join(room.code);
    socket.data.room=room.code;
    socket.data.role="host";
    socket.emit("host:ok");
    broadcast(room);
  });

  socket.on("host:question", ({index, question}) => {
    const room=rooms.get(socket.data.room);
    if(!room || socket.data.role!=="host") return;
    if(Number.isInteger(index) && index>=0 && index<room.questions.length) room.current=index;
    if(question) room.questions[room.current]=question;
    room.locked=false; room.revealed=false;
    for(const p of room.participants.values()) p.answer=null;
    broadcast(room);
  });

  socket.on("host:updateQuestions", questions => {
    const room=rooms.get(socket.data.room);
    if(!room || socket.data.role!=="host") return;
    room.questions=Array.isArray(questions)?questions:[];
    if(room.current>=room.questions.length) room.current=0;
    broadcast(room);
  });

  socket.on("host:lock", () => {
    const room=rooms.get(socket.data.room);
    if(!room) return;
    room.locked=true; broadcast(room);
  });

  socket.on("host:unlock", () => {
    const room=rooms.get(socket.data.room);
    if(!room) return;
    room.locked=false; broadcast(room);
  });

  socket.on("host:reveal", () => {
    const room=rooms.get(socket.data.room);
    if(!room) return;
    room.revealed=true;
    const q=room.questions[room.current];
    for(const p of room.participants.values()) {
      if(p.answer && q && p.answer===q.answer) p.score += Number(q.points)||0;
    }
    room.locked=true;
    broadcast(room);
  });

  socket.on("host:next", () => {
    const room=rooms.get(socket.data.room);
    if(!room) return;
    if(room.current < room.questions.length-1) room.current++;
    room.locked=false; room.revealed=false;
    for(const p of room.participants.values()) p.answer=null;
    broadcast(room);
  });

  socket.on("host:prev", () => {
    const room=rooms.get(socket.data.room);
    if(!room) return;
    if(room.current > 0) room.current--;
    room.locked=false; room.revealed=false;
    for(const p of room.participants.values()) p.answer=null;
    broadcast(room);
  });

  socket.on("host:resetScores", () => {
    const room=rooms.get(socket.data.room);
    if(!room) return;
    for(const p of room.participants.values()) p.score=0;
    broadcast(room);
  });

  socket.on("join", ({code:c,name}) => {
    const room=rooms.get(String(c||"").toUpperCase());
    if(!room) return socket.emit("errorMsg","방 코드를 확인해주세요.");
    const n=String(name||"").trim().slice(0,20);
    if(!n) return socket.emit("errorMsg","이름을 입력해주세요.");
    const p={id:socket.id,name:n,score:0,answer:null};
    room.participants.set(socket.id,p);
    socket.join(room.code);
    socket.data.room=room.code;
    socket.data.role="player";
    socket.emit("joined",{code:room.code,name:n});
    broadcast(room);
  });

  socket.on("answer", value => {
    const room=rooms.get(socket.data.room);
    if(!room || socket.data.role!=="player") return;
    const p=room.participants.get(socket.id);
    if(!p || room.locked || room.revealed) return;
    const q=room.questions[room.current];
    if(!q) return;
    if(q.options.some(o=>o.value===value)) {
      p.answer=value;
      broadcast(room);
    }
  });

  socket.on("disconnect", () => {
    const c=socket.data.room;
    if(!c) return;
    const room=rooms.get(c);
    if(!room) return;
    if(socket.data.role==="player") room.participants.delete(socket.id);
    else if(room.host===socket.id) room.host=null;
    broadcast(room);
  });
});

app.get("/health", (_,res)=>res.json({ok:true}));
app.get("*", (_,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log("QuizShow running on "+PORT));
