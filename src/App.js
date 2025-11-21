// client/src/App.jsx
import React, { useState, useEffect } from "react";
import { socket } from "./client/src/socket";
import "./App.css"


export default function App() {
  // Initialize states and variables
  const [stage, setStage] = useState("home");
  const [joining, setJoining] = useState(false);
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [players, setPlayers] = useState([]);
  const [question, setQuestion] = useState("");
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    socket.on("gameCreated", (c) => { setCode(c); setStage("lobby"); setIsHost(true)});
    socket.on("playersUpdate", (p) => setPlayers(p));
    socket.on("receiveQuestion", (q) => { setQuestion(q); setStage("question"); });
    socket.on("errorMessage", (msg) => alert(msg));
  }, []);

  useEffect(() => {
    socket.on("hostUpdate", () => setIsHost(true));
    return () => socket.off("hostUpdate");
  }, []);

  const leaveLobby = () => {
  // Emit leave event to server
  if (code) {
    socket.emit("leaveGame", code); // tell server to remove this player
  }
  socket.emit("leaveGame", code);
  // Reset state to go back home
  setStage("home");
  setJoining(false);
  setUsername("");
  setCode("");
  setPlayers([]);
  setIsHost(false);
  };

  const host = (e) => {
    e.preventDefault();
    if (!username.trim()) {
      alert("Username is Required!")
      return;
    }
    socket.emit("hostGame", { username });
  }
  const join = (e) => {
    e.preventDefault();
    if (!username.trim()) {
      alert("Username is required!");
      return;
    }
    if(!code.trim()) return alert("Game Code is Required");

    socket.emit("joinGame", { code, username });
    setStage("lobby");
  };
  const start = () => socket.emit("startGame", code);


  //----------------JSX SECTION------------------------------------------------
  if (stage === "home")
    return (
      <div className="home-main">
        <div className="home-header">
          <h2>Find the Imposter</h2>
        </div>

        <form className="home-form">
          {/* Username Input */}
          <input
              placeholder="Username"
              className="home-inputs"
              maxLength={8}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          {/* ---------- FORM #1: Host Game Screen ---------- */}
          {!joining && (
          <>
            <button onClick={(host)} className="home-buttons" disabled={!username.trim()}>
              Host Game
            </button>

            <button onClick={() => setJoining(true)} className="home-buttons" >
              Join Game
            </button>
          </>
        )}

        {/* ---------- FORM #2: Join game screen ---------- */}
        {joining && (
          <>
            <input
              placeholder="Game Code"
              className="home-inputs"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />

            <button onClick={join} className="home-buttons" disabled={!username.trim()}>
              Join
            </button>

            <button onClick={() => setJoining(false)} className="home-buttons">
              Back
            </button>
          </>
        )}
        </form>
      </div>
    );

  if (stage === "lobby")
    return (
      <div className="lobby-main">
        <div className="lobby-gamecode">
          <h2>Game Code:</h2>
          <h2>{code}</h2>
        </div>

        <div className="lobby-players">
          <p>Players:</p>
          <ul className="lobby-list">
            {players.map((p) => <li key={p.id}>{p.username}</li>)}
          </ul>
        </div>
        {isHost && players.length >= 3 && (
          <button onClick={start} className="lobby-start-button">
            Start Game
          </button>
        )}
        <button onClick={leaveLobby} className="lobby-start-button">
          Leave
        </button>
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
