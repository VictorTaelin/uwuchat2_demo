import { UwUChat2Client } from 'uwuchat2';

// Types
// -----

const FPS = 32;
const PID = Math.floor(Math.random() * (2 ** 16));

console.log("PID is:", PID);

type Time = number; // 48-bit
type Tick = number; // 48-bit
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
  = { $: "SetNick", time: Time, pid: UID, name: string }
  | { $: "KeyEvent", time: Time, pid: UID, key: Key, down: boolean };

type StateLogs  = { [key: Tick]: GameState };
type ActionLogs = { [key: Tick]: Action[] };

// Utils
// -----

// converts Time to Tick
function time_to_tick(time: Time): Tick {
  return Math.floor(time / 1000 * FPS);
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
  var dt = 1 / FPS;
  for (var pid in gs.players) {
    var player = gs.players[pid];
    player.pos.x += ((player.key["D"] ? 1 : 0) + (player.key["A"] ? -1 : 0)) * dt * 64;
    player.pos.y += ((player.key["S"] ? 1 : 0) + (player.key["W"] ? -1 : 0)) * dt * 64;
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

  // TODO: draw the player as a filled gray circle, centered around their pos, with the name in a small font above the circle
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

// StateComputer
// -------------

type State = {
  state_logs: StateLogs,
  action_logs: ActionLogs,
};

function get_initial_tick(action_logs: ActionLogs): number {
  var lowest_tick = Infinity;
  for (var tick in action_logs) {
    lowest_tick = Math.min(lowest_tick, parseInt(tick));
  }
  return lowest_tick;
}

// TODO: get_current_tick using Date.now() and time to tick
function get_current_tick(): number {
  return time_to_tick(client.time());
}

// FIXME: O(N) => O(1)
function compute(action_logs: ActionLogs): GameState {
  var state = init(); // state 0

  var ini_tick = get_initial_tick(action_logs);
  var end_tick = get_current_tick();

  //console.log("COMPUTE", ini_tick, end_tick);

  // TODO: should this be '<='? should compute actions after|before tick?
  for (var t = ini_tick; t < end_tick; ++t) {
    // Computes the tick
    state = tick(state);

    // Computes the actions
    var actions = action_logs[t];
    if (actions) {
      for (var action of actions) {
        state = when(action, state);
      }
    } 
  }

  return state;
}

// Handles inputs
// --------------

// Create an object to track the current state of keys
const keyState: { [key: string]: boolean } = {};

function handle_key_event(event: KeyboardEvent) {
  const key = event.key.toUpperCase();
  if (['W', 'A', 'S', 'D'].includes(key)) {
    const isKeyDown = event.type === 'keydown';
    if (keyState[key] !== isKeyDown) {
      keyState[key] = isKeyDown;
      var time = client.time();
      var tick = time_to_tick(time);
      var action : Action = {
        $    : "KeyEvent",
        time : time,
        pid  : PID,
        key  : key,
        down : isKeyDown
      };
      // Add to own action log 
      // TODO: abstract into modular function
      if (!state.action_logs[tick]) {
        state.action_logs[tick] = [];
      }
      state.action_logs[tick].push(action);
      // Send to server
      client.send(room, serialize_action(action));
    }
  }
}

window.addEventListener('keydown', handle_key_event);
window.addEventListener('keyup', handle_key_event);

// Handles messages
// ----------------

function on_message(msg: Uint8Array) {
  try {
    // Deserializes the message
    var action = deserialize_action(msg);
    var tick   = time_to_tick(action.time);
    var hash   = JSON.stringify(action);

    // Initilize this tick's actions
    if (!state.action_logs[tick]) {
      state.action_logs[tick] = [];
    }

    // Get this tick's actions
    var actions = state.action_logs[tick];

    // If the message is duplicated, skip it
    for (let action of actions) {
      if (JSON.stringify(action) == hash) {
        return;
      }
    }
    
    // Pushes the action
    actions.push(action); 

  } catch (e) {
    // pass
  }
}

// Game Loop
// ---------

function game_loop() {
  // Compute the current game state
  const current_state = compute(state.action_logs);

  // Draw the current state
  draw(current_state);

  // Print the current state
  //console.log("app_state: " + JSON.stringify(state));
  //console.log("gme_state: " + JSON.stringify(current_state));

  // Schedule the next frame
  requestAnimationFrame(game_loop);
}

// Main
// ----

// Initial State
var room  : UID   = Number(prompt("room:") || 0);
var state : State = { state_logs: {}, action_logs: {} };

// Inits the client
const client = new UwUChat2Client();
//await client.init('ws://localhost:7171');
await client.init('ws://server.uwu.games');

// Joins room
const leave = client.recv(room, on_message);

// Start the game loop
game_loop();
