export type Time = number; // 48-bit
export type Tick = number; // 48-bit

export type StateLogs<S>  = { [key: Tick]: S };
export type ActionLogs<A> = { [key: Tick]: A[] };

export type Mach<S, A> = {
  ticks_per_second: number,
  genesis_tick: Tick,
  cached_tick: Tick,
  state_logs: StateLogs<S>,
  action_logs: ActionLogs<A>,
};

export type Game<S, A> = {
  init: () => S,
  when: (action: A, state: S) => S,
  tick: (state: S) => S,
};

// TODO: new_mach function
export function new_mach<S, A>(ticks_per_second: number): Mach<S, A> {
  return {
    ticks_per_second,
    genesis_tick: Infinity,
    cached_tick: -Infinity,
    state_logs: {},
    action_logs: {},
  };
}

export function time_to_tick<S, A>(mach: Mach<S, A>, time: Time): Tick {
  return Math.floor(time / 1000 * mach.ticks_per_second);
}

export function register_action<S, A>(mach: Mach<S, A>, action: A & { time: Time }) {
  var time = action.time;
  var tick = time_to_tick(mach, time);
  var hash = JSON.stringify(action);
  
  // Initilize this tick's actions
  if (!mach.action_logs[tick]) {
    mach.action_logs[tick] = [];
  }

  // Updates the first action tick
  mach.genesis_tick = Math.min(mach.genesis_tick, tick);
  
  // Get this tick's actions
  var actions = mach.action_logs[tick];

  // If the message is duplicated, skip it
  for (let action of actions) {
    if (JSON.stringify(action) == hash) {
      return;
    }
  }

  // Deletes all >tick states
  for (let t = tick+1; t <= mach.cached_tick; ++t) {
    delete mach.state_logs[t];
  }
  mach.cached_tick = Math.min(mach.cached_tick, tick);

  // Pushes the action
  actions.push(action); 
}

export function compute<S, A>(mach: Mach<S, A>, game: Game<S, A>, time: Time): S {
  var ini_t = mach.cached_tick;
  var end_t = time_to_tick(mach, time);
  var state = mach.state_logs[ini_t];

  if (!state) {
    state = game.init();
    ini_t = mach.genesis_tick;
  }

  if (end_t - ini_t > 1000) {
    return state;
  }

  // NOTE: actions of tick X happen AFTER its recorded state
  for (var t = ini_t; t <= end_t; ++t) {
    // Caches this tick
    mach.cached_tick = Math.max(mach.cached_tick, t);
    mach.state_logs[t] = state;

    // Computes the tick
    state = game.tick(state);

    // Computes the actions
    var actions = mach.action_logs[t] || [];
    for (var action of actions) {
      state = game.when(action, state);
    }
  }

  return state;
}
