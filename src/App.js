import React, { useState, useEffect } from "react";
import { socket } from "./client/src/socket";
import "./App.css";

export default function App() {
  // core UI state
  const [stage, setStage] = useState("home"); // home, lobby, question, waiting, reveal, vote, results, countdown
  const [joining, setJoining] = useState(false);

  // player / lobby state
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [players, setPlayers] = useState([]);
  const [isHost, setIsHost] = useState(false);

  // per-round state
  const [countdown, setCountdown] = useState(null); // numeric display for countdowns
  const [myId, setMyId] = useState(null);
  const [role, setRole] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  // reveal stage state
  const [revealPlayers, setRevealPlayers] = useState([]); // list of {id, username}
  const [revealData, setRevealData] = useState([]); // revealed entries { playerId, username, answer }
  const [nextToReveal, setNextToReveal] = useState(null);

  // voting stage
  const [votePlayers, setVotePlayers] = useState([]); // {id, username}
  const [voteSubmitted, setVoteSubmitted] = useState(false);

  // results
  const [results, setResults] = useState(null);
  const [playAgainClicked, setPlayAgainClicked] = useState(false);
  const [playAgainProgress, setPlayAgainProgress] = useState({ count: 0, total: 0 });
  const [votingResults, setVotingResults] = useState(null);

  // helper: find username by id
  const getUsername = (id) => {
    const p = players.find((x) => x.id === id) || revealPlayers.find((x) => x.id === id);
    return p ? p.username : "Unknown";
  };

  // -------------------- socket listeners --------------------
  useEffect(() => {
    // connection id
    socket.on("connect", () => {
      setMyId(socket.id);
    });

    socket.on("gameCreated", (c) => {
      setCode(c);
      setStage("lobby");
    });

    socket.on("playersUpdate", (p) => {
      setPlayers(p);
    });

    socket.on("hostUpdate", () => {
      setIsHost(true);
    });

    // used by server before each new round
    socket.on("nextRoundCountdown", ({ seconds } = { seconds: 3 }) => {
      setCountdown(seconds ?? 3);
      setStage("countdown");

      // show countdown locally (decrement every 1s until 0)
      let c = seconds ?? 3;
      const t = setInterval(() => {
        c -= 1;
        setCountdown(c);
        if (c <= 0) {
          clearInterval(t);
          setCountdown(null);
        }
      }, 1000);
    });

    // server signals clients to show question UI for this round
    socket.on("gameStarting", () => {
      setAnswer("");
      setRevealData([]);
      setNextToReveal(null);
      setVotePlayers([]);
      setVoteSubmitted(false);
      setResults(null);
      setPlayAgainClicked(false);
      setPlayAgainProgress({ count: 0, total: players.length });
      setStage("question");
    });

    // server may send a "countdown" event (older code); handle gracefully
    socket.on("countdown", (num) => {
      setCountdown(num);
    });

    // private role / question to each player
    socket.on("role", ({ role }) => setRole(role));
    socket.on("question", (q) => setQuestion(q));

    // when all submitted, server emits allSubmitted with player list for reveal ordering
    socket.on("allSubmitted", ({ players: submittedPlayers }) => {
      setRevealPlayers(submittedPlayers || []);
      setRevealData([]);
      setStage("reveal");
    });

    // which socket id should press reveal next
    socket.on("nextToReveal", ({ nextId }) => {
      setNextToReveal(nextId);
    });

    // when a player's answer is revealed to all
    socket.on("playerRevealed", ({ playerId, answer }) => {
      const username = getUsername(playerId);
      setRevealData((old) => [...old, { playerId, username, answer }]);
    });

    socket.on("dropdownUnlocked", ({ players: pls } = {}) => {
      // used as a signal that reveal finished
      // no enforced UI here — votingStart will follow normally
    });

    // server tells client to show voting UI
    socket.on("votingStart", ({ players: playersForVoting }) => {
      setVotePlayers(playersForVoting || []);
      setStage("vote");
      setVoteSubmitted(false);
    });

    // voting results
    socket.on("votingResults", (payload) => {
      setResults(payload);
      setStage("results");
    });

    // progress of play again (optional)
    socket.on("playAgainProgress", ({ count, total }) => {
      setPlayAgainProgress({ count, total });
    });

    // errors
    socket.on("errorMessage", (msg) => {
      alert(msg);
    });

    socket.on("votingResults", ({ votes, imposterId, imposterCaught }) => {
      setVotingResults({ votes, imposterId, imposterCaught });
      setStage("results");
    });

    // cleanup on unmount
    return () => {
      socket.off("connect");
      socket.off("gameCreated");
      socket.off("playersUpdate");
      socket.off("hostUpdate");
      socket.off("nextRoundCountdown");
      socket.off("gameStarting");
      socket.off("countdown");
      socket.off("role");
      socket.off("question");
      socket.off("allSubmitted");
      socket.off("nextToReveal");
      socket.off("playerRevealed");
      socket.off("dropdownUnlocked");
      socket.off("votingStart");
      socket.off("votingResults");
      socket.off("playAgainProgress");
      socket.off("errorMessage");
      socket.off("votinResults");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players]);

  // -------------------- event handlers --------------------
  const hostGame = (e) => {
    e?.preventDefault();
    if (!username.trim()) return alert("Username is required!");
    socket.emit("hostGame", { username });
    setIsHost(true);
  };

  const startGame = () => {
    if (!isHost) return;
    if (players.length < 3) return alert("Need at least 3 players to start.");
    socket.emit("startGame", code);
  };

  const joinGame = (e) => {
    e?.preventDefault();
    if (!username.trim()) return alert("Username is required!");
    if (!code.trim()) return alert("Game Code is required");
    socket.emit("joinGame", { code, username });
    setStage("lobby");
  };

  const leaveLobby = () => {
    if (code) socket.emit("leaveGame", code);
    // reset local client state
    setStage("home");
    setJoining(false);
    setUsername("");
    setCode("");
    setPlayers([]);
    setIsHost(false);
    setCountdown(null);
    setRole("");
    setQuestion("");
    setAnswer("");
    setRevealPlayers([]);
    setRevealData([]);
    setNextToReveal(null);
    setVotePlayers([]);
    setResults(null);
    setPlayAgainClicked(false);
  };

  const submitAnswer = (e) => {
    e?.preventDefault();
    if (!answer.trim()) return alert("Please Answer You Idiot");
    socket.emit("submitAnswer", { code, answer });
    setStage("waiting");
  };

  const handlePlayerShow = () => {
    // only allowed when it's this player's turn (server enforces)
    if (!myId) return;
    socket.emit("playerShow", { code, playerIdToShow: myId });
  };

  const submitVote = (accusedId) => {
    if (!code || !accusedId) return;
    socket.emit("submitVote", { code, accusedId });
    setVoteSubmitted(true);
    setStage("waiting");
  };

  const handlePlayAgain = () => {
    if (!code) return;
    socket.emit("playAgain", { code });
    setPlayAgainClicked(true);
  };

  // helper to render countdown text
  const renderCountdown = () => {
    if (countdown === null) return null;
    return <h1 style={{ fontSize: 80 }}>{countdown}</h1>;
  };

  // -------------------- JSX per stage --------------------
  if (stage === "home")
    return (
      <div className="home-main">
        <div className="home-header">
          <h2>Find the Imposter</h2>
        </div>

        <form className="home-form" onSubmit={(e) => e.preventDefault()}>
          <input
            placeholder="Username"
            className="home-inputs"
            maxLength={16}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />

          {!joining && (
            <>
              <button
                onClick={hostGame}
                className="home-buttons"
                disabled={!username.trim()}
              >
                Host Game
              </button>

              <button
                onClick={() => setJoining(true)}
                className="home-buttons"
              >
                Join Game
              </button>
            </>
          )}

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

              <button
                onClick={joinGame}
                className="home-buttons"
                disabled={!username.trim()}
              >
                Join
              </button>

              <button
                onClick={() => setJoining(false)}
                className="home-buttons"
              >
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
            {players.map((p) => (
              <li key={p.id}>{p.username}</li>
            ))}
          </ul>
        </div>

        {isHost && players.length >= 3 && (
          <button onClick={startGame} className="lobby-start-button">
            Start Game
          </button>
        )}
        <button onClick={leaveLobby} className="lobby-start-button">
          Leave
        </button>
      </div>
    );

  if (stage === "countdown")
    return (
      <div className="game-container">
        {renderCountdown()}
      </div>
    );

  if (stage === "question")
    return (
      <div className="game-container">
        {countdown !== null ? (
          <h1 style={{ fontSize: 80n }}>{countdown}</h1>
        ) : (
          <>
            <div className="question-header">
              <h2>You are:</h2>
              <h2>{role}</h2>
              <p>{question}</p>
            </div>
            <input
              placeholder="Your Answer"
              className="answer-input"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              required
            />
            <button className="home-buttons" onClick={submitAnswer}>
              Submit
            </button>
          </>
        )}
      </div>
    );

  if (stage === "waiting")
    return (
      <div className="game-container">
        <div className="waiting-screen">
          <h1>Waiting for others... </h1>
        </div>
      </div>
    );

  if (stage === "reveal")
    return (
      <div className="game-container">
        <div className="question-header">
          <h2>Time to Reveal</h2>
        </div>

        <div className="reveal-list">
          {revealPlayers.map((p) => {
            const revealed = revealData.find((r) => r.playerId === p.id);
            return (
              <div key={p.id} className="reveal-item">
                <strong>{p.username}:</strong>{" "}
                {revealed ? revealed.answer : ""}
              </div>
            );
          })}
        </div>

        {nextToReveal && nextToReveal === myId ? (
          <button className="home-buttons" onClick={handlePlayerShow}>
            Show Answer
          </button>
        ) : (
          <p className="who-waiting">
            {nextToReveal
              ? `${getUsername(nextToReveal)}'s turn to reveal`
              : "Waiting..."}
          </p>
        )}
      </div>
    );

  if (stage === "vote")
    return (
      <div className="game-container">
        <h2 className="vote-header">Who is the Imposter?</h2>

          <div className="reveal-list">
            {revealPlayers.map((p) => {
              const revealed = revealData.find((r) => r.playerId === p.id);
              return (
                <div key={p.id} className="reveal-item">
                  <strong>{p.username}:</strong>{" "}
                  {revealed ? revealed.answer : ""}
                </div>
              );
            })}
          </div>
        <div className="vote-grid">
          {votePlayers.map((p) => (
            <button
              key={p.id}
              className="home-buttons"
              onClick={() => submitVote(p.id)}
              disabled={voteSubmitted}
            >
              {p.username}
            </button>
          ))}
        </div>
      </div>
    );

  if (stage === "results" && results && votingResults)
    return (
      <div className="results-container">
        <h2>{results.imposterCaught ? "Imposter Caught!" : "Imposter Escaped!"}</h2>
        <h2>Imposter Was: { players.find(p => p.id === votingResults.imposterId)?.username || "Unknown"}</h2>

          <h3>Votes:</h3> 
        <div className="results-list">
          {Object.entries(results.votes || {}).map(([pid, info]) => (
            <p key={pid}>
              {info.username}: {info.count}
            </p>
          ))}
        </div>

        <div className="results-bottom">
          <p>
            Play again progress: {playAgainProgress.count} / {players.length}
          </p>

          <button
            className="home-buttons"
            onClick={handlePlayAgain}
            disabled={playAgainClicked}
          >
            {playAgainClicked ? "Waiting..." : "Play Again"}
          </button>
        </div>
      </div>
    );

  // fallback
  return null;
}