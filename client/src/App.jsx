// client/src/App.jsx
import React, { useState, useEffect } from "react";
import { socket } from "../../src/socket";

export default function App() {
  const [stage, setStage] = useState("home");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [players, setPlayers] = useState([]);
  const [question, setQuestion] = useState("");

  useEffect(() => {
    socket.on("gameCreated", (c) => { setCode(c); setStage("lobby"); });
    socket.on("playersUpdate", (p) => setPlayers(p));
    socket.on("receiveQuestion", (q) => { setQuestion(q); setStage("question"); });
  }, []);

  const host = () => socket.emit("hostGame", { username });
  const join = () => socket.emit("joinGame", { code, username });
  const start = () => socket.emit("startGame", code);

  if (stage === "home")
    return (
      <div>
        <input placeholder="Username" onChange={(e) => setUsername(e.target.value)} />
        <button onClick={host}>Host Game</button>
        <input placeholder="Game Code" onChange={(e) => setCode(e.target.value)} />
        <button onClick={join}>Join Game</button>
      </div>
    );

  if (stage === "lobby")
    return (
      <div>
        <h2>Game Code: {code}</h2>
        <ul>{players.map((p) => <li key={p.id}>{p.username}</li>)}</ul>
        <button onClick={start}>Start Game</button>
      </div>
    );

  if (stage === "question")
    return (
      <div>
        <h2>Your Question:</h2>
        <p>{question}</p>
        <input placeholder="Your Answer" />
        <button>Submit</button>
      </div>
    );

  return null;
}
