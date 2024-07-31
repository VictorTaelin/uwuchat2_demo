import * as sm from './state_machine';
import { UwUChat2Client } from 'uwuchat2';

// Types
// -----

const TPS = 32;
const PID = Math.floor(Math.random() * (2 ** 16));
console.log("PID is:", PID);

type UID  = number; // 48-bit
type Key  = string; // 8-bit
type Name = string; // UTF-16

type Vector2 = {
  x : number,
  y : number,
};

type Player = {
  id   : UID;
  name : Name;
  pos  : Vector2;
  key  : { [key: Key]: boolean };
};

type GameState = {
  tick    : number,
  players : { [key: UID]: Player },
};

type Action
  = { $: "SetNick", time: sm.Time, pid: UID, name: string }
  | { $: "KeyEvent", time: sm.Time, pid: UID, key: Key, down: boolean };

// Application
// -----------

// Initial State
function init(): GameState {
  return { tick: 0, players: {} };
}

// Computes an Action
function when(when: Action, gs: GameState): GameState {
  var gs = JSON.parse(JSON.stringify(gs)) as GameState; // FIXME: use immutable.js instead
  if (!gs.players[when.pid]) {
    gs.players[when.pid] = { id: when.pid, name: "Anon", pos: { x: 256, y: 128 }, key: {} };
  }
  switch (when.$) {
    case "SetNick": {
      gs.players[when.pid].name = when.name;
      break;
    }
    case "KeyEvent": {
      gs.players[when.pid].key[when.key] = when.down;
      break;
    }
  }
  return gs;
}

// Computes a Tick
function tick(gs: GameState): GameState {
  var gs = JSON.parse(JSON.stringify(gs)) as GameState; // FIXME: use immutable.js instead
  var dt = 1 / TPS;
  for (var pid in gs.players) {
    var obj = gs.players[pid];
    obj.pos.x += ((obj.key["D"] ? 1 : 0) + (obj.key["A"] ? -1 : 0)) * dt * 128;
    obj.pos.y += ((obj.key["S"] ? 1 : 0) + (obj.key["W"] ? -1 : 0)) * dt * 128;
  }
  gs.tick += 1;
  return gs;
}

// Renders the GameState on the canvas
function draw(gs: GameState): void {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Clear the canvas
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw the player as a filled gray circle, centered around their pos, with the name in a small font above the circle
  for (const player of Object.values(gs.players)) {
    // Draw player circle
    ctx.beginPath();
    ctx.arc(player.pos.x, player.pos.y, 15, 0, 2 * Math.PI);
    ctx.fillStyle = 'gray';
    ctx.fill();

    // Draw player name
    ctx.fillStyle = 'black';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, player.pos.x, player.pos.y - 20);
  }
}

// Serialization
// -------------
// (For the Action type only.)

function serialize_action(action: Action): Uint8Array {
  const encoder = new TextEncoder();
  let buffer: number[] = [];
  switch (action.$) {
    case "SetNick": {
      buffer.push(0); // Action type identifier for SetNick
      buffer.push(...new Uint8Array(new BigUint64Array([BigInt(action.time)]).buffer).slice(0, 6)); // 48-bit Time
      buffer.push(...new Uint8Array(new BigUint64Array([BigInt(action.pid)]).buffer).slice(0, 6)); // 48-bit UID
      buffer.push(...encoder.encode(action.name));
      break;
    }
    case "KeyEvent": {
      buffer.push(1); // Action type identifier for KeyEvent
      buffer.push(...new Uint8Array(new BigUint64Array([BigInt(action.time)]).buffer).slice(0, 6)); // 48-bit Time
      buffer.push(...new Uint8Array(new BigUint64Array([BigInt(action.pid)]).buffer).slice(0, 6)); // 48-bit UID
      buffer.push(action.key.charCodeAt(0)); // 8-bit Key
      buffer.push(action.down ? 1 : 0); // Boolean as 1 or 0
      break;
    }
  }
  return new Uint8Array(buffer);
}

function deserialize_action(data: Uint8Array): Action {
  const decoder = new TextDecoder();
  switch (data[0]) {
    case 0: { // SetNick
      const tick_buffer = new Uint8Array(8);
      tick_buffer.set(data.slice(1, 7), 0);
      const time = Number(new BigUint64Array(tick_buffer.buffer)[0]);
      const pid_buffer = new Uint8Array(8);
      pid_buffer.set(data.slice(7, 13), 0);
      const pid = Number(new BigUint64Array(pid_buffer.buffer)[0]);
      const name = decoder.decode(data.slice(13));
      return { $: "SetNick", time, pid, name };
    }
    case 1: { // KeyEvent
      const tick_buffer = new Uint8Array(8);
      tick_buffer.set(data.slice(1, 7), 0);
      const time = Number(new BigUint64Array(tick_buffer.buffer)[0]);
      const pid_buffer = new Uint8Array(8);
      pid_buffer.set(data.slice(7, 13), 0);
      const pid = Number(new BigUint64Array(pid_buffer.buffer)[0]);
      const key = String.fromCharCode(data[13]);
      const down = data[14] === 1;
      return { $: "KeyEvent", time, pid, key, down };
    }
    default: {
      throw new Error("Unknown action type");
    }
  }
}

// Main App
// --------

// Starts State Machine
var room : UID = Math.floor(Math.random() * 2 ** 32);
var mach : sm.Mach<GameState, Action> = sm.new_mach(TPS);

// Connects to Server
const client = new UwUChat2Client();
await client.init('ws://localhost:7171');
//await client.init('ws://server.uwu.games');

// Joins Room & Handles Messages
const leave = client.recv(room, msg => {
  try { sm.register_action(mach, deserialize_action(msg)); }
  catch (e) {}
});

// Input Handler
const key_state: { [key: string]: boolean } = {};
function handle_key_event(event: KeyboardEvent) {
  const key = event.key.toUpperCase();
  if (['W', 'A', 'S', 'D'].includes(key)) {
    const down = event.type === 'keydown';
    if (key_state[key] !== down) {
      key_state[key] = down;
      var time = client.time();
      var act  = {$: "KeyEvent", time, pid: PID, key, down} as Action;
      // Add to own action log 
      sm.register_action(mach, act);
      // Send to server
      client.send(room, serialize_action(act));
    }
  }
}
window.addEventListener('keydown', handle_key_event);
window.addEventListener('keyup', handle_key_event);

// Game Loop
function game_loop() {
  // Compute the current state
  const state = sm.compute(mach, {init,tick,when}, client.time());

  // Draw the current state
  draw(state);

  // Schedule the next frame
  requestAnimationFrame(game_loop);
}
game_loop();
