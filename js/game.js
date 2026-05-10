/* Break Braket v2 — game.js
   Features:
   - Separate logical canvas sizing
   - Multiple levels with unique layouts
   - Power-ups: expand, multiball (simplified), extralife, slow, sticky, laser
   - Background music via WebAudio (a simple looped chiptune-like sequence)
   - Sound effects via WebAudio
   - Controls: arrows/A-D, mouse, space/click
*/

(() => {
  // Logical canvas size
  // Logical canvas size
  const W = 960, H = 540;
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  // UI elements
  const scoreEl = document.getElementById('score');
  const multiplierEl = document.getElementById('multiplier');
  const livesEl = document.getElementById('lives');
  const levelEl = document.getElementById('level');
  const btnRestart = document.getElementById('btnRestart');
  const btnToggleSound = document.getElementById('btnToggleSound');
  const btnToggleMusic = document.getElementById('btnToggleMusic');
  const overlay = document.getElementById('overlay');

  // Game state
  let score = 0, lives = 3, level = 1;
  let running = false, soundOn = true, musicOn = false;
  let paused = false;
  let levelIntroTime = 0;
  let shake = 0; // current shake intensity

  // Paddle
  // Paddle
  const paddle = { baseW: 120, w: 120, h: 14, x: (W-120)/2, y: H - 60, speed: 10, expand: 1, sticky: false, stickyTimer: 0, gunActive: false, gunTimer: 0, gunCooldown: 0 };

  // Ball(s) - support simplified multiball as just one ball with speed change, but we keep array for clarity
  let balls = [{ r: 9, x: W/2, y: paddle.y - 12, vx: 0, vy: 0, stuck: true, speed: 6, trail: [] }];

  // Bricks & powerups
  const brickCfg = { rows: 5, cols: 10, w: 78, h: 26, pad: 8, top: 70, left: 28 };
  let bricks = [];
  const powerups = []; // { x,y,vy,type,ttl }

  // Background stars & nebula
  const stars = [];
  for (let i = 0; i < 80; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.5, o: Math.random(), s: 0.005 + Math.random() * 0.01 });
  
  const nebula = [
    { x: W*0.2, y: H*0.3, r: 240, c: 'rgba(139, 92, 246, 0.08)', vx: 0.2, vy: 0.1 },
    { x: W*0.8, y: H*0.7, r: 300, c: 'rgba(236, 72, 153, 0.06)', vx: -0.15, vy: -0.1 }
  ];

  // Bullets
  const bullets = [];
  class Bullet {
    constructor(x, y) {
      this.x = x; this.y = y;
      this.vy = -12;
      this.alive = true;
    }
    update(t) {
      this.y += this.vy * t;
      if (this.y < 0) this.alive = false;
    }
    draw(ctx) {
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(this.x - 2, this.y - 8, 4, 16);
      ctx.shadowBlur = 10; ctx.shadowColor = '#f43f5e';
      ctx.fillRect(this.x - 2, this.y - 8, 4, 16);
      ctx.shadowBlur = 0;
    }
  }

  // Particle System
  const particles = [];
  class Particle {
    constructor(x, y, color) {
      this.x = x; this.y = y;
      this.vx = (Math.random() - 0.5) * 8;
      this.vy = (Math.random() - 0.5) * 8;
      this.life = 1.0;
      this.decay = 0.02 + Math.random() * 0.03;
      this.color = color;
      this.size = 2 + Math.random() * 4;
    }
    update(t) {
      this.vy += 0.2 * t; // gravity
      this.vx *= Math.pow(0.98, t); // friction
      this.vy *= Math.pow(0.98, t);
      this.x += this.vx * t;
      this.y += this.vy * t;
      this.life -= this.decay * t;
    }
    draw(ctx) {
      ctx.globalAlpha = Math.max(0, this.life);
      ctx.fillStyle = this.color;
      ctx.fillRect(this.x, this.y, this.size, this.size);
      ctx.globalAlpha = 1.0;
    }
  }

  function spawnBurst(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) particles.push(new Particle(x, y, color));
  }

  function addShake(amt) {
    shake = Math.min(20, shake + amt);
  }

  function spawnFlame(x, y, color = '#f59e0b') {
    const p = new Particle(x, y, color);
    p.vx *= 0.3; p.vy = (Math.random() * -3) - 1;
    p.decay = 0.04; p.size = 3 + Math.random() * 5;
    particles.push(p);
  }

  // WebAudio setup
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const audioCtx = AudioContext ? new AudioContext() : null;

  // --- MUSIC (looped simple pattern using oscillators) ---
  let musicNode = null; // used to stop music
  function startMusic() {
    if (!audioCtx || !musicOn) return;
    if (musicNode) return;
    // create a simple sequencer using periodic scheduling
    const master = audioCtx.createGain(); master.gain.value = 0.12; master.connect(audioCtx.destination);
    const tempo = 100; // BPM
    const beatDuration = 60 / tempo;
    let step = 0;
    const pattLead = [0, 2, 4, 7, 9, 7, 4, 2]; // relative semitone pattern
    const baseFreq = 220;
    const scheduler = setInterval(() => {
      // lead synth
      const note = pattLead[step % pattLead.length];
      const freq = baseFreq * Math.pow(2, note / 12);
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sawtooth';
      g.gain.value = 0.0001;
      o.connect(g); g.connect(master);
      o.frequency.value = freq;
      o.start();
      // envelope
      const now = audioCtx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.7, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + beatDuration * 0.9);
      setTimeout(() => o.stop(), (beatDuration * 1000) * 0.9 + 40);

      // sub-bass pulse every 2 steps
      if (step % 2 === 0) {
        const ob = audioCtx.createOscillator();
        const gb = audioCtx.createGain();
        ob.type = 'sine';
        ob.frequency.value = baseFreq / 2;
        gb.gain.value = 0.001;
        ob.connect(gb); gb.connect(master);
        ob.start();
        const nnow = audioCtx.currentTime;
        gb.gain.setValueAtTime(0.001, nnow);
        gb.gain.exponentialRampToValueAtTime(0.00001, nnow + beatDuration * 0.9);
        setTimeout(() => ob.stop(), (beatDuration * 1000) * 0.9 + 30);
      }

      step++;
      if (!musicOn) { clearInterval(scheduler); musicNode = null; }
    }, beatDuration * 500); // schedule twice per beat for snappier feel

    musicNode = { stop: () => { musicOn = false; clearInterval(scheduler); master.disconnect(); musicNode = null; } };
  }
  function stopMusic() { if (musicNode) musicNode.stop(); musicNode = null; }

  // --- SOUND EFFECTS (utility) ---
  function sfx(freq, dur = 80, type = 'sine', vol = 0.04) {
    if (!audioCtx || !soundOn) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur / 1000);
    setTimeout(() => o.stop(), dur + 10);
  }

  function updateHUD() {
    scoreEl.textContent = score;
    const mult = 1 + Math.floor(scoreStreak / 5);
    multiplierEl.textContent = 'x' + mult;
    livesEl.textContent = lives;
    levelEl.textContent = level;
  }

  const floatingTexts = []; // { x, y, text, life, color }
  function spawnFloatingText(x, y, text, color = '#ffd166') {
    floatingTexts.push({ x, y, text, life: 1.0, color });
  }

  // Fit canvas responsively
  function fitCanvas() {
    const containerW = Math.min(window.innerWidth - 20, 980);
    const scale = containerW / W;
    canvas.style.width = Math.round(W * scale) + 'px';
    canvas.style.height = Math.round(H * scale) + 'px';
  }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  // Input handling
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    if (e.key === ' ') {
      e.preventDefault();
      if (balls.every(b => b.stuck)) launchBall();
      else running = !running;
    }
  });
  window.addEventListener('keyup', (e) => keys[e.key] = false);

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;
    paddle.x = Math.max(10, Math.min(W - paddle.w - 10, mouseX - paddle.w / 2));
    if (balls[0] && balls[0].stuck) balls[0].x = paddle.x + paddle.w / 2;
  });

  // Touch controls
  const handleTouch = (e) => {
    if (e.touches.length > 0) {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const scaleX = W / rect.width;
      const mouseX = (touch.clientX - rect.left) * scaleX;
      paddle.x = Math.max(10, Math.min(W - paddle.w - 10, mouseX - paddle.w / 2));
      if (balls[0] && balls[0].stuck) {
        balls[0].x = paddle.x + paddle.w / 2;
      }
    }
  };
  canvas.addEventListener('touchstart', handleTouch, {passive: false});
  canvas.addEventListener('touchmove', handleTouch, {passive: false});

  canvas.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended' && (soundOn || musicOn)) audioCtx.resume();
    if (balls.every(b => b.stuck)) launchBall();
    else running = !running;
  });

  // Launch ball
  function launchBall() {
    for (const b of balls) {
      if (!b.stuck) continue;
      b.stuck = false;
      const ang = (Math.random() * Math.PI * 0.6) + Math.PI * 1.1;
      b.vx = Math.cos(ang) * b.speed;
      b.vy = Math.sin(ang) * b.speed;
    }
    running = true;
  }

  // Collision helper
  function rectIntersect(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // --- Level definitions (distinct layouts) ---
  // For flexibility, each level has row/col, and a pattern function to decide placement/type
  const levelDefs = [
    // Level 1: simple bracket-ish
    (L) => {
      const rows = 4; const cols = 9;
      const arr = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // bracket arms at edges
          if (c === 0 || c === cols - 1 || r === 0) arr.push({r,c,type:0});
          else if (Math.random() < 0.05) arr.push({r,c,type:3}); // explosive
          else if (Math.random() < 0.06) arr.push({r,c,type:2}); // power
          else if (Math.random() < 0.07) arr.push({r,c,type:1}); // tough
          else arr.push({r,c,type:0});
        }
      }
      return { rows, cols, arr };
    },
    // Level 2: center gap big (strong bracket)
    (L) => {
      const rows = 5, cols = 11;
      const arr = [];
      for (let r=0;r<rows;r++){
        for (let c=0;c<cols;c++){
          const gapStart = 4, gapEnd = cols-1-gapStart;
          if ((c<2||c>cols-3) || r===0) {
            if (Math.random()<0.09) arr.push({r,c,type:1}); 
            else if (Math.random()<0.05) arr.push({r,c,type:3}); // explosive
            else arr.push({r,c,type:0});
          } else {
            if (Math.random()<0.08) arr.push({r,c,type:2});
          }
        }
      }
      return { rows, cols, arr };
    },
    // Level 3: staggered with more tough bricks
    (L) => {
      const rows = 6, cols = 10; const arr=[];
      for(let r=0;r<rows;r++){
        for(let c=0;c<cols;c++){
          const rnd = Math.random();
          if ((r+c)%2===0 && rnd<0.85) arr.push({r,c,type: (Math.random()<0.12?1:0)});
          else if (rnd<0.07) arr.push({r,c,type:2});
          else if (rnd<0.12) arr.push({r,c,type:3});
        }
      }
      return { rows, cols, arr };
    },
    // Level 4: denser, more power-ups & tough
    (L) => {
      const rows = 6, cols = 12; const arr=[];
      for(let r=0;r<rows;r++){
        for(let c=0;c<cols;c++){
          const rnd=Math.random();
          if (rnd<0.12) arr.push({r,c,type:2});
          else if (rnd<0.18) arr.push({r,c,type:3}); // explosive
          else if (rnd<0.28) arr.push({r,c,type:1});
          else if (rnd<0.9) arr.push({r,c,type:0});
        }
      }
      return { rows, cols, arr };
    }
  ];

  // Build bricks for current level
  function buildBricksForLevel(levelIndex) {
    bricks = [];
    const defFn = levelDefs[(levelIndex - 1) % levelDefs.length];
    const def = defFn(levelIndex);
    const rows = def.rows, cols = def.cols;
    // compute brick size to fit nicely
    const totalPadX = (cols - 1) * brickCfg.pad;
    const totalW = cols * brickCfg.w + totalPadX;
    // center horizontally
    const left = (W - totalW) / 2;
    for (const e of def.arr) {
      const x = left + e.c * (brickCfg.w + brickCfg.pad);
      const y = brickCfg.top + e.r * (brickCfg.h + brickCfg.pad) - Math.max(0, (def.rows - brickCfg.rows) * 8);
      bricks.push({
        x, y, w: brickCfg.w, h: brickCfg.h,
        type: e.type || 0, alive: true, hit: (e.type === 1 ? 2 : 1)
      });
    }
    // reset paddle/balls
    paddle.w = paddle.baseW * paddle.expand;
    paddle.x = Math.max(10, Math.min(W - paddle.w - 10, (W - paddle.w) / 2));
    balls = [{ r: 9, x: W/2, y: paddle.y - 12, vx:0, vy:0, stuck:true, speed: 8 + (level - 1) * 0.5, trail: [], mega: false }];
  }

  // Powerup application
  function applyPowerup(type) {
    switch(type) {
      case 'expand':
        paddle.expand = Math.min(1.8, paddle.expand + 0.4);
        paddle.w = paddle.baseW * paddle.expand;
        paddle.x = Math.max(10, Math.min(W - paddle.w - 10, paddle.x));
        score += 15;
        break;
      case 'multiball':
        // simplified: create a second ball based on main ball
        if (balls.length < 3) {
          const main = balls[0];
          const b2 = { r: main.r, x: main.x+8, y: main.y-6, vx: -main.vx * 0.9, vy: main.vy * 0.9, stuck:false, speed: main.speed, trail: [] };
          balls.push(b2);
          score += 30;
        }
        break;
      case 'extralife':
        lives = Math.min(9, lives + 1); score += 50;
        break;
      case 'slow':
        // slow everything temporarily
        slowTimer = 12 * 60; // frames (~12 seconds at 60fps)
        break;
      case 'sticky':
        paddle.sticky = true; paddle.stickyTimer = 10 * 60; // 10 seconds
        break;
      case 'laser':
        laserAmmo = Math.min(6, laserAmmo + 3);
        score += 25;
        break;
      case 'fireball':
        for (const b of balls) { b.fireball = true; b.fireballTimer = 6 * 60; }
        score += 40;
        break;
      case 'annihilator':
        paddle.gunActive = true; paddle.gunTimer = 8 * 60;
        score += 60;
        break;
      case 'megaball':
        for (const b of balls) { b.mega = true; b.megaTimer = 10 * 60; b.r = 18; }
        score += 80;
        break;
    }
    updateHUD();
  }

  // Spawning powerups when bricks die
  function spawnPowerup(x,y) {
    const types = ['expand','multiball','extralife','slow','sticky','laser','fireball','annihilator','megaball'];
    // weighted choose
    const r = Math.random();
    let type = 'expand';
    if (r<0.06) type = 'extralife';
    else if (r<0.14) type = 'multiball';
    else if (r<0.22) type = 'fireball';
    else if (r<0.30) type = 'annihilator';
    else if (r<0.36) type = 'megaball';
    else if (r<0.46) type = 'slow';
    else if (r<0.58) type = 'sticky';
    else if (r<0.66) type = 'laser';
    else type = 'expand';
    powerups.push({ x, y, vy: 1.6, type, ttl: 12 * 60 });
  }

  // Game dynamics extras
  let slowTimer = 0;
  let laserAmmo = 0;
  let scoreStreak = 0;

  // Laser firing (shoots small ray upward)
  function fireLaser() {
    if (laserAmmo <= 0) return;
    laserAmmo--;
    sfx(1200, 90, 'square', 0.04);
    // simple instant hit: remove any brick in vertical line
    const centerX = paddle.x + paddle.w / 2;
    for (const b of bricks) {
      if (!b.alive) continue;
      if (centerX > b.x && centerX < b.x + b.w) {
        b.alive = false;
        score += 20;
        spawnBurst(b.x + b.w / 2, b.y + b.h / 2, '#fb923c', 15);
        if (Math.random() < 0.35) spawnPowerup(b.x + b.w/2, b.y + b.h/2);
      }
    }
    updateHUD();
  }

  // Main update loop
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(40, now - last); last = now;
    let t = dt / 16;
    update(t);
    render();
    requestAnimationFrame(loop);
  }

  function update(t) {
    // Update nebula
    for (const n of nebula) {
      n.x += n.vx * t; n.y += n.vy * t;
      if (n.x < -n.r) n.x = W + n.r; if (n.x > W + n.r) n.x = -n.r;
      if (n.y < -n.r) n.y = H + n.r; if (n.y > H + n.r) n.y = -n.r;
    }
    // Manage start-of-level intro
    if (levelIntroTime > 0) {
      levelIntroTime -= (1 * t);
      if (levelIntroTime <= 0) {
        overlay.classList.add('hidden');
        levelIntroTime = 0;
        running = true;
      }
      return;
    }

    // Input
    if (keys['ArrowLeft'] || keys['a']) paddle.x -= paddle.speed * (paddle.expand > 1 ? 1.1 : 1);
    if (keys['ArrowRight'] || keys['d']) paddle.x += paddle.speed * (paddle.expand > 1 ? 1.1 : 1);
    // Laser key (L or K)
    if ((keys['l'] || keys['L'] || keys['k']) && laserAmmo > 0) {
      fireLaser();
      keys['l'] = false; keys['L'] = false; keys['k'] = false;
    }
    // clamp paddle
    paddle.x = Math.max(10, Math.min(W - paddle.w - 10, paddle.x));
    if (balls.every(b => b.stuck)) {
      for (const b of balls) {
        b.x = paddle.x + paddle.w / 2; 
        b.y = paddle.y - 12; 
        b.fireball = false; b.fireballTimer = 0;
        b.mega = false; b.megaTimer = 0; b.r = 9;
      }
    }

    // timers
    if (paddle.sticky) {
      paddle.stickyTimer--;
      if (paddle.stickyTimer <= 0) { paddle.sticky = false; paddle.stickyTimer = 0; }
    }
    if (paddle.gunActive) {
      paddle.gunTimer--;
      if (paddle.gunCooldown > 0) paddle.gunCooldown--;
      if (paddle.gunTimer <= 0) { paddle.gunActive = false; paddle.gunTimer = 0; }
      
      if (running && paddle.gunCooldown <= 0) {
        bullets.push(new Bullet(paddle.x + 10, paddle.y));
        bullets.push(new Bullet(paddle.x + paddle.w - 10, paddle.y));
        paddle.gunCooldown = 15;
        sfx(1500, 40, 'square', 0.02);
      }
    }
    if (slowTimer > 0) { slowTimer--; }
    const speedFactor = slowTimer > 0 ? 0.55 : 1.0;

    // decay shake
    if (shake > 0) shake *= Math.pow(0.9, t);
    if (shake < 0.1) shake = 0;

    if (!running) return;

    // Move balls
    for (let bi = balls.length - 1; bi >= 0; bi--) {
      const b = balls[bi];
      if (b.stuck) continue;
      b.x += b.vx * t * speedFactor;
      b.y += b.vy * t * speedFactor;

      if (!b.stuck && running) {
        spawnFlame(b.x, b.y, b.mega ? '#ec4899' : (b.fireball ? '#fb923c' : '#8ef2d9'));
      }

      if (b.fireballTimer > 0) {
        b.fireballTimer -= t;
        if (b.fireballTimer <= 0) { b.fireball = false; b.fireballTimer = 0; }
      }
      if (b.megaTimer > 0) {
        b.megaTimer -= t;
        if (b.megaTimer <= 0) { b.mega = false; b.megaTimer = 0; b.r = 9; }
        if (running) addShake(0.5);
      }

      // Update trail
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 8) b.trail.shift();

      // wall collisions
      if (b.x - b.r < 6) { b.x = b.r + 6; b.vx *= -1; sfx(600, 50); spawnBurst(b.x - b.r, b.y, '#ffffff', 4); addShake(2); }
      if (b.x + b.r > W - 6) { b.x = W - b.r - 6; b.vx *= -1; sfx(600, 50); spawnBurst(b.x + b.r, b.y, '#ffffff', 4); addShake(2); }
      if (b.y - b.r < 6) { b.y = b.r + 6; b.vy *= -1; sfx(700, 60); spawnBurst(b.x, b.y - b.r, '#ffffff', 4); addShake(2); }

      // bottom -> lose ball
      if (b.y - b.r > H) {
        balls.splice(bi, 1);
        sfx(180, 160);
        if (balls.length === 0) {
          lives--; scoreStreak = 0; updateHUD();
          addShake(15);
          if (lives <= 0) {
            gameOver();
            return;
          }
          // reset a new ball
          balls = [{ r: 9, x: W/2, y: paddle.y - 12, vx:0, vy:0, stuck:true, speed: 8 + (level - 1) * 0.5, trail: [], mega: false }];
          running = false;
        }
        continue;
      }

      // paddle collision
      if (b.y + b.r >= paddle.y && b.y + b.r <= paddle.y + paddle.h && b.x > paddle.x && b.x < paddle.x + paddle.w) {
        // if sticky paddle, stick ball
        if (paddle.sticky && Math.random() < 0.7) {
          b.stuck = true; b.x = paddle.x + paddle.w / 2; b.y = paddle.y - 12;
          sfx(900, 40);
        } else {
          const rel = (b.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2); // -1..1
          const ang = rel * Math.PI * 0.48 + -Math.PI / 2;
          const sp = Math.hypot(b.vx, b.vy) || b.speed;
          b.vx = Math.cos(ang) * Math.max(sp, b.speed);
          b.vy = Math.sin(ang) * Math.max(sp, b.speed);
          // slight speed boost
          b.vx *= 1.02; b.vy *= 1.02;
          sfx(950, 36);
          spawnBurst(b.x, b.y + b.r, '#0ea5a4', 8);
          addShake(3);
          scoreStreak = 0; updateHUD();
        }
      }

      // bricks collision: handle one brick per ball per frame
      for (const br of bricks) {
        if (!br.alive) continue;
        if (rectIntersect(b.x - b.r, b.y - b.r, b.r*2, b.r*2, br.x, br.y, br.w, br.h)) {
          if (!b.fireball && !b.mega) {
            const overlapX = b.x - Math.max(br.x, Math.min(b.x, br.x + br.w));
            const overlapY = b.y - Math.max(br.y, Math.min(b.y, br.y + br.h));
            if (Math.abs(overlapX) > Math.abs(overlapY)) b.vx *= -1; else b.vy *= -1;
          }
          br.hit--;
          sfx(br.type === 1 ? 380 : 520, 70);
          if (br.hit <= 0) {
            br.alive = false;
            const mult = 1 + Math.floor(scoreStreak / 5);
            score += (br.type === 1 ? 30 : 10) * mult;
            scoreStreak++;
            if (scoreStreak % 5 === 0 && scoreStreak > 0) {
              spawnFloatingText(br.x + br.w/2, br.y, 'COMBO x' + (1 + scoreStreak/5), '#8ef2d9');
              sfx(1400, 100, 'square', 0.04);
            }
            const brickColor = br.type === 1 ? '#d946ef' : (br.type === 2 ? '#f43f5e' : (br.type === 3 ? '#fb7185' : '#6366f1'));
            spawnBurst(br.x + br.w / 2, br.y + br.h / 2, brickColor, 16);
            addShake(br.type === 3 ? 12 : 3);

            // Explosion logic for Type 3
            if (br.type === 3) {
              sfx(200, 300, 'sawtooth', 0.08);
              spawnBurst(br.x + br.w / 2, br.y + br.h / 2, '#ef4444', 40);
              const range = 100;
              for (const other of bricks) {
                if (other.alive && other !== br) {
                  const dx = (other.x + other.w / 2) - (br.x + br.w / 2);
                  const dy = (other.y + other.h / 2) - (br.y + br.h / 2);
                  if (Math.hypot(dx, dy) < range) {
                    other.alive = false;
                    score += 15;
                    spawnBurst(other.x + other.w / 2, other.y + other.h / 2, '#fca5a5', 10);
                  }
                }
              }
            }

            // spawn powerups based on type
            if (br.type === 2 && Math.random() < 0.9) spawnPowerup(br.x + br.w/2, br.y + br.h/2);
            else if (Math.random() < 0.04) spawnPowerup(br.x + br.w/2, br.y + br.h/2);
          } else {
            scoreStreak = 0;
          }
          updateHUD();
          break;
        }
      }
    }

    // Update powerups
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += p.vy * (1 * (slowTimer>0 ? 0.6 : 1));
      p.ttl--;
      if (rectIntersect(p.x - 10, p.y - 10, 20, 20, paddle.x, paddle.y, paddle.w, paddle.h)) {
        applyPowerup(p.type);
        spawnBurst(p.x, p.y, '#ffd166', 20);
        powerups.splice(i, 1);
        sfx(1200, 120, 'square', 0.05);
      } else if (p.y > H || p.ttl <= 0) {
        powerups.splice(i, 1);
      }
    }

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      particles[i].update(t);
      if (particles[i].life <= 0) particles.splice(i, 1);
    }

    // Update bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const bu = bullets[i];
      bu.update(t);
      if (!bu.alive) { bullets.splice(i, 1); continue; }
      // collision with bricks
      for (const br of bricks) {
        if (!br.alive) continue;
        if (bu.x > br.x && bu.x < br.x + br.w && bu.y > br.y && bu.y < bu.y + br.h) {
          br.hit--;
          bu.alive = false;
          if (br.hit <= 0) {
            br.alive = false;
            score += 10;
            spawnBurst(br.x + br.w/2, br.y + br.h/2, '#f43f5e', 8);
          }
          break;
        }
      }
    }

    // Update floating texts
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      floatingTexts[i].y -= 0.8 * t;
      floatingTexts[i].life -= 0.015 * t;
      if (floatingTexts[i].life <= 0) floatingTexts.splice(i, 1);
    }

    // Level clear?
    const anyAlive = bricks.some(b => b.alive);
    if (!anyAlive) {
      level++;
      score += 120 * level;
      nextLevel();
    }
  }

  // Level transition
  function nextLevel() {
    running = false;
    overlay.textContent = `Level ${level}\nReady...`;
    overlay.classList.remove('hidden');
    levelIntroTime = 1.4; // seconds before start
    buildBricksForLevel(level);
    updateHUD();
    sfx(1000, 160, 'sawtooth', 0.05);
  }

  function gameOver() {
    sfx(120, 600, 'sine', 0.06);
    setTimeout(() => {
      alert('Game Over — score: ' + score);
      score = 0; lives = 3; level = 1;
      startNewGame();
    }, 120);
  }

  // Render
  function render() {
    ctx.save();
    if (shake > 0) {
      const sx = (Math.random() - 0.5) * shake;
      const sy = (Math.random() - 0.5) * shake;
      ctx.translate(sx, sy);
    }
    ctx.clearRect(-50,-50,W+100,H+100);

    // Dynamic Background
    const bgGrd = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W);
    bgGrd.addColorStop(0, '#1e1b4b'); bgGrd.addColorStop(1, '#0f172a');
    ctx.fillStyle = bgGrd; ctx.fillRect(0,0,W,H);

    // Nebula Clouds
    for (const n of nebula) {
      if (isNaN(n.x) || isNaN(n.y)) continue;
      const g = ctx.createRadialGradient(n.x, n.y, 10, n.x, n.y, n.r);
      g.addColorStop(0, n.c); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI*2); ctx.fill();
    }

    // Stars
    for (const s of stars) {
      s.o += s.s;
      const alpha = 0.2 + Math.abs(Math.sin(s.o)) * 0.6;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill();
    }

    // Glowing Reactive Grid
    const gridAlpha = 0.04 + (shake / 20) * 0.15;
    ctx.strokeStyle = `rgba(139, 92, 246, ${gridAlpha})`;
    ctx.lineWidth = 1;
    const gridSize = 60;
    for (let x = 0; x < W; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Vignette
    const vig = ctx.createRadialGradient(W/2, H/2, W*0.3, W/2, H/2, W*0.8);
    vig.addColorStop(0, 'transparent'); vig.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = vig; ctx.fillRect(0,0,W,H);

    // Bricks
    for (const b of bricks) {
      if (!b.alive) continue;
      if (b.type === 1) ctx.fillStyle = '#d946ef'; // magenta for tough
      else if (b.type === 2) ctx.fillStyle = '#f43f5e'; // rose for power
      else if (b.type === 3) ctx.fillStyle = '#fb7185'; // light rose for explosive
      else ctx.fillStyle = '#6366f1'; // indigo for normal
      roundRect(ctx, b.x, b.y, b.w, b.h, 6, true, false);
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.font = '14px Outfit, Arial';
      ctx.fillText(b.type === 3 ? '!!!' : '[ ]', b.x + 8, b.y + b.h - 8);
    }

    // Powerups
    for (const p of powerups) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI*2);
      ctx.fillStyle = '#ffd166'; ctx.fill();
      ctx.fillStyle = '#1b1b1b';
      ctx.font = '12px Arial';
      let sym = '?';
      if (p.type === 'expand') sym = '+P';
      else if (p.type === 'extralife') sym = '+L';
      else if (p.type === 'multiball') sym = '*';
      else if (p.type === 'slow') sym = 'S';
      else if (p.type === 'sticky') sym = 'S*';
      else if (p.type === 'laser') sym = 'L';
      else if (p.type === 'fireball') sym = 'F';
      else if (p.type === 'annihilator') sym = 'A';
      else if (p.type === 'megaball') sym = 'M';
      ctx.fillText(sym, p.x-6, p.y+4);
    }

    // Particles
    for (const p of particles) p.draw(ctx);

    // Bullets
    for (const bu of bullets) bu.draw(ctx);

    // Floating Texts
    for (const ft of floatingTexts) {
      ctx.globalAlpha = Math.max(0, ft.life);
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 20px Outfit, Arial';
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.globalAlpha = 1.0;
    }
    ctx.textAlign = 'left';

    // Paddle
    ctx.fillStyle = '#8b5cf6';
    roundRect(ctx, paddle.x, paddle.y, paddle.w, paddle.h, 8, true, false);
    if (paddle.gunActive) {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(paddle.x, paddle.y - 10, 10, 20);
      ctx.fillRect(paddle.x + paddle.w - 10, paddle.y - 10, 10, 20);
    }

    // Balls
    for (const b of balls) {
      // Draw trail
      for (let i = 0; i < b.trail.length; i++) {
        const tr = b.trail[i];
        const alpha = (i + 1) / b.trail.length * 0.3;
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, b.r * (i + 1) / b.trail.length, 0, Math.PI * 2);
        ctx.fillStyle = b.fireball ? `rgba(251,146,60,${alpha})` : `rgba(255,255,255,${alpha})`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
      ctx.fillStyle = b.mega ? '#ec4899' : (b.fireball ? '#fb923c' : '#ffffff'); ctx.fill();
      ctx.strokeStyle = b.mega ? '#f43f5e' : (b.fireball ? '#ef4444' : 'rgba(255,255,255,0.08)'); ctx.stroke();
    }

    // Laser ammo indicator
    if (laserAmmo > 0) {
      ctx.fillStyle = '#ffd166';
      ctx.font = '14px Outfit, Arial';
      ctx.fillText('Laser: ' + laserAmmo, W - 120, 28);
    }

    // HUD overlay small
    ctx.fillStyle = 'rgba(255,255,255,0.02)'; ctx.fillRect(0,0,W,48);
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(6,6,160,32);
    ctx.fillStyle = '#a8f0e0'; ctx.font = 'bold 14px Outfit, Arial'; ctx.fillText('Break Braket v2', 14, 28);

    // If stuck, draw hint
    if (balls.every(b => b.stuck)) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(W/2-200, H/2-28, 400, 56);
      ctx.fillStyle = '#cfeee6';
      ctx.font = '16px Outfit, Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Press Space or Click to Launch', W/2, H/2+6);
      ctx.textAlign = 'left';
    }

    // Overlay visibility control
    if (levelIntroTime > 0) {
      overlay.classList.remove('hidden');
      overlay.style.top = (H * 0.26) + 'px';
      overlay.textContent = `Level ${level}\nStarting...`;
    } else {
      overlay.classList.add('hidden');
    }

    ctx.restore();
  }

  // Helpers
  function roundRect(ctx,x,y,w,h,r,fill,stroke) {
    if (typeof r === 'undefined') r = 6;
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  // Buttons
  btnRestart.addEventListener('click', () => {
    score = 0; lives = 3; level = 1; startNewGame();
    if (audioCtx && audioCtx.state === 'suspended' && (soundOn || musicOn)) audioCtx.resume();
  });

  btnToggleSound.addEventListener('click', () => {
    soundOn = !soundOn;
    btnToggleSound.textContent = 'Sound: ' + (soundOn ? 'On' : 'Off');
    if (soundOn && audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  });

  btnToggleMusic.addEventListener('click', () => {
    musicOn = !musicOn;
    btnToggleMusic.textContent = 'Music: ' + (musicOn ? 'On' : 'Off');
    if (musicOn) startMusic();
    else stopMusic();
  });

  // Start new game / level setup functions
  function startNewGame() {
    paddle.expand = 1; paddle.w = paddle.baseW; paddle.x = (W - paddle.w) / 2;
    laserAmmo = 0; slowTimer = 0; paddle.sticky = false;
    buildBricksForLevel(level);
    overlay.classList.remove('hidden');
    overlay.textContent = `Level ${level}`;
    levelIntroTime = 1.4;
    updateHUD();
    if (musicOn) startMusic();
  }

  // initialize first game
  startNewGame();

  // Begin the frame loop
  requestAnimationFrame(loop);
})();
