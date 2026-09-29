// Reuses the original game's AudioEngine and portrait artwork. Appearance uses only public person IDs.
  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rngFor = (key) => mulberry32(hashString(String(key)));
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  const chance = (rng, p) => rng() < p;
  const range = (rng, min, max) => Math.floor(rng() * (max - min + 1)) + min;


export class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.started = false;
      this.enabled = true;
      this.drones = [];
      this.timer = null;
    }

    start() {
      if (this.started) {
        if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
        return;
      }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? 0.13 : 0;
        this.master.connect(this.ctx.destination);

        [55, 82.41, 110].forEach((f, i) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const filter = this.ctx.createBiquadFilter();
          osc.type = i === 1 ? "triangle" : "sine";
          osc.frequency.value = f;
          gain.gain.value = i === 0 ? .24 : .07;
          filter.type = "lowpass";
          filter.frequency.value = 280;
          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.master);
          osc.start();
          this.drones.push({ osc, gain });
        });

        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.frequency.value = .11;
        lfoGain.gain.value = .025;
        lfo.connect(lfoGain);
        lfoGain.connect(this.master.gain);
        lfo.start();
        this.drones.push({ osc: lfo, gain: lfoGain });

        this.timer = setInterval(() => {
          if (!this.enabled || !this.ctx || this.ctx.state !== "running") return;
          const notes = [146.83, 164.81, 196, 220];
          this.chime(notes[Math.floor(Math.random() * notes.length)], .035);
        }, 6800);

        this.started = true;
      } catch (e) {
        console.warn("Audio unavailable", e);
      }
    }

    setEnabled(v) {
      this.enabled = v;
      if (this.master && this.ctx) {
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.setTargetAtTime(v ? .13 : 0, this.ctx.currentTime, .04);
      }
    }

    tone(freq, duration, type = "sine", volume = .1, slide = null) {
      if (!this.enabled || !this.ctx || !this.master) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + duration);
      gain.gain.setValueAtTime(.0001, t);
      gain.gain.exponentialRampToValueAtTime(volume, t + .018);
      gain.gain.exponentialRampToValueAtTime(.0001, t + duration);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + duration + .03);
    }

    chime(freq = 196, volume = .05) {
      this.tone(freq, 1.6, "sine", volume, freq * .98);
      setTimeout(() => this.tone(freq * 1.5, 1.1, "sine", volume * .5), 70);
    }

    sfx(type) {
      if (type === "allow") {
        this.tone(120, .12, "triangle", .22, 70);
        setTimeout(() => this.tone(240, .18, "sine", .09, 180), 45);
      } else if (type === "reject") {
        this.tone(145, .22, "square", .09, 92);
      } else if (type === "search") {
        this.tone(420, .11, "sine", .07, 760);
        setTimeout(() => this.tone(610, .14, "sine", .06, 420), 90);
      } else if (type === "isolate") {
        this.tone(92, .38, "triangle", .18, 48);
        setTimeout(() => this.tone(61, .4, "sine", .15, 45), 90);
      } else if (type === "day") {
        this.chime(174.61, .05);
        setTimeout(() => this.chime(220, .04), 300);
      }
    }
  }


  function portraitSVG(c, mini = false) {
    if (!c) return "";
    const rng = rngFor(c.seed + ":portrait");
    const skin = c.race.tone;
    const outfitHue = range(rng, 18, 220);
    const outfit = "hsl(" + outfitHue + " 24% 25%)";
    const outfit2 = "hsl(" + outfitHue + " 20% 18%)";
    const hairHue = pick(rng, [20, 28, 35, 45, 210, 0]);
    const hairLight = pick(rng, [15, 20, 25, 35, 50]);
    const hair = "hsl(" + hairHue + " 24% " + hairLight + "%)";
    const eye = pick(rng, ["#caa36c","#779a94","#7c8f62","#7d6d9d","#c6c0aa","#794f3d"]);
    const hairStyle = range(rng, 0, 3);
    const hasBeard = chance(rng, .24);
    const hasScar = chance(rng, .18);
    const badge = c.profession.includes("士兵") || c.profession === "护卫" ? "✦" :
                  c.profession.includes("商") ? "¤" :
                  c.profession.includes("学") || c.profession === "教师" ? "▤" :
                  c.profession.includes("医") || c.profession === "草药师" ? "✚" : "◆";

    let ears = "";
    if (c.race.ear === "long") {
      ears = '<path d="M52 72 L24 58 L49 88Z" fill="' + skin + '" stroke="#32261f" stroke-width="2"/><path d="M108 72 L136 58 L111 88Z" fill="' + skin + '" stroke="#32261f" stroke-width="2"/>';
    } else if (c.race.ear === "wide") {
      ears = '<path d="M51 70 Q24 55 29 86 Q39 83 52 87Z" fill="' + skin + '" stroke="#32261f" stroke-width="2"/><path d="M109 70 Q136 55 131 86 Q121 83 108 87Z" fill="' + skin + '" stroke="#32261f" stroke-width="2"/>';
    } else if (c.race.ear === "cat") {
      ears = '<path d="M48 57 L43 27 L68 51Z" fill="' + skin + '" stroke="#32261f" stroke-width="2"/><path d="M112 57 L117 27 L92 51Z" fill="' + skin + '" stroke="#32261f" stroke-width="2"/>';
    } else if (c.race.ear === "fin") {
      ears = '<path d="M51 70 L27 61 L35 79 L25 88 L53 88Z" fill="#6f98a1" stroke="#26383b" stroke-width="2"/><path d="M109 70 L133 61 L125 79 L135 88 L107 88Z" fill="#6f98a1" stroke="#26383b" stroke-width="2"/>';
    } else if (c.race.ear === "goat") {
      ears = '<path d="M53 67 Q32 58 25 72 Q39 80 53 82Z" fill="' + skin + '" stroke="#32261f" stroke-width="2"/><path d="M107 67 Q128 58 135 72 Q121 80 107 82Z" fill="' + skin + '" stroke="#32261f" stroke-width="2"/>';
    } else if (c.race.ear === "round") {
      ears = '<circle cx="49" cy="78" r="10" fill="' + skin + '" stroke="#32261f" stroke-width="2"/><circle cx="111" cy="78" r="10" fill="' + skin + '" stroke="#32261f" stroke-width="2"/>';
    }

    let horns = "";
    if (["提夫林","山羊人","龙裔"].includes(c.race.name)) {
      horns = '<path d="M57 50 Q42 25 54 16 Q50 35 69 48Z" fill="#655648" stroke="#32261f" stroke-width="2"/><path d="M103 50 Q118 25 106 16 Q110 35 91 48Z" fill="#655648" stroke="#32261f" stroke-width="2"/>';
    }

    const hairPaths = [
      '<path d="M49 63 Q49 37 80 34 Q111 37 111 64 Q96 50 79 53 Q64 48 49 63Z" fill="' + hair + '"/>',
      '<path d="M49 65 Q45 35 79 33 Q116 35 111 68 L101 53 L94 60 L86 50 L75 60 L63 51Z" fill="' + hair + '"/>',
      '<path d="M50 61 Q63 36 81 35 Q100 36 110 59 Q89 48 50 61Z" fill="' + hair + '"/><path d="M107 56 Q121 72 112 96 L104 81Z" fill="' + hair + '"/>',
      '<path d="M52 58 Q63 40 80 39 Q97 40 108 58 Q96 52 80 52 Q64 52 52 58Z" fill="' + hair + '"/>'
    ];

    const scar = hasScar ? '<path d="M98 64 L90 91 M101 65 L94 91" stroke="#70483c" stroke-width="1.2" opacity=".7"/>' : "";
    const beard = hasBeard ? '<path d="M61 94 Q63 124 80 132 Q99 124 100 94 Q93 113 80 117 Q68 113 61 94Z" fill="' + hair + '" opacity=".9"/>' : "";
    const raven = c.race.name === "鸦人" ? '<path d="M48 76 Q80 54 113 75 Q102 41 80 37 Q57 41 48 76Z" fill="#35383c" opacity=".75"/>' : "";
    const scales = (c.race.name === "蜥蜴人" || c.race.name === "龙裔") ? '<path d="M59 63 L64 57 L69 63 M76 58 L81 52 L86 58 M93 62 L98 56 L103 63" stroke="#445244" stroke-width="2" fill="none"/>' : "";

    return '<svg viewBox="0 0 160 170" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + c.name + '">' +
      '<defs><linearGradient id="bg' + (mini ? "m" : "f") + '" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#4a4033"/><stop offset="1" stop-color="#171713"/></linearGradient></defs>' +
      '<rect x="3" y="3" width="154" height="164" rx="7" fill="url(#bg' + (mini ? "m" : "f") + ')" opacity=".8"/>' +
      '<path d="M28 168 Q32 126 63 119 L96 119 Q129 126 134 168Z" fill="' + outfit + '" stroke="#0d0e0d" stroke-width="2"/>' +
      '<path d="M55 125 L80 151 L106 125 L96 118 L63 118Z" fill="' + outfit2 + '"/>' +
      '<rect x="69" y="105" width="22" height="24" rx="8" fill="' + skin + '"/>' +
      ears + horns +
      '<ellipse cx="80" cy="79" rx="31" ry="37" fill="' + skin + '" stroke="#32261f" stroke-width="2"/>' +
      '<path d="M60 75 Q67 70 73 75" fill="none" stroke="#332b25" stroke-width="2"/>' +
      '<path d="M87 75 Q94 70 101 75" fill="none" stroke="#332b25" stroke-width="2"/>' +
      '<ellipse cx="67" cy="76" rx="3.2" ry="4.2" fill="' + eye + '"/><ellipse cx="94" cy="76" rx="3.2" ry="4.2" fill="' + eye + '"/>' +
      '<path d="M80 79 L77 91 Q80 94 85 91" fill="none" stroke="#5c4234" stroke-width="1.5"/>' +
      '<path d="M69 101 Q80 ' + (chance(rng,.5) ? 106 : 99) + ' 92 101" fill="none" stroke="#55372f" stroke-width="2"/>' +
      scar + beard + hairPaths[hairStyle] +
      '<circle cx="112" cy="138" r="10" fill="#b38b45" stroke="#4a3820" stroke-width="2"/>' +
      '<text x="112" y="142" text-anchor="middle" font-size="10" fill="#211a10">' + badge + '</text>' +
      raven + scales + '</svg>';
  }


export function publicPortrait(person){const p=person||{person_id:'preview',job:'守门人'};return portraitSVG({seed:p.person_id+':decorative-only',name:'候检者',profession:p.job||'',race:{tone:'#b79376',ear:'round',name:'人类'}});}
