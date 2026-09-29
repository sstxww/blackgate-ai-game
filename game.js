
(() => {
  "use strict";

  const DB = window.DUNGEON_DB;
  if (!DB) {
    document.body.innerHTML = "<pre style='color:white'>数据文件加载失败：data.js</pre>";
    throw new Error("DUNGEON_DB missing");
  }

  const $ = (id) => document.getElementById(id);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const STORAGE_KEY = "blackgate_inspector_save_v1";
  const CAMPAIGN_DAYS = 14;

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

  function sample(rng, arr, count) {
    const copy = arr.slice();
    const out = [];
    while (copy.length && out.length < count) {
      out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
    }
    return out;
  }

  function weightedPick(rng, list, getWeight = (x) => x.weight ?? 1) {
    const total = list.reduce((s, x) => s + Math.max(0, getWeight(x)), 0);
    let roll = rng() * total;
    for (const item of list) {
      roll -= Math.max(0, getWeight(item));
      if (roll <= 0) return item;
    }
    return list[list.length - 1];
  }

  const DIFFICULTIES = {
    easy:   { label: "见习审查员", badMult: .78, penalty: .84, cases: 10, searches: 5, cells: 4 },
    normal: { label: "黑门值勤官", badMult: 1.00, penalty: 1.00, cases: 12, searches: 4, cells: 3 },
    hard:   { label: "深层封锁线", badMult: 1.28, penalty: 1.18, cases: 14, searches: 3, cells: 2 }
  };

  let selectedDifficulty = "normal";
  let toastTimer = null;

  function freshState() {
    return {
      version: 1,
      seed: Date.now() + "-" + Math.random().toString(36).slice(2),
      difficulty: selectedDifficulty,
      day: 1,
      caseIndex: 0,
      cases: [],
      directives: [],
      gold: 120,
      security: 72,
      economy: 68,
      public: 64,
      threat: 10,
      searches: 4,
      cells: 3,
      pressure: 0,
      processed: 0,
      decisions: [],
      history: [],
      pendingEvents: [],
      currentNews: [],
      dayStart: null,
      reportReady: false,
      campaignEnded: false,
      sound: true
    };
  }

  let state = freshState();

  class AudioEngine {
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

  const audio = new AudioEngine();

  function getDirectiveMods() {
    const mods = {};
    state.directives.forEach(d => {
      Object.entries(d.mods || {}).forEach(([k, v]) => {
        if (typeof v === "number") mods[k] = (mods[k] || 0) + v;
      });
    });
    return mods;
  }

  function archetypeFor(rng) {
    const diff = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;
    const mods = getDirectiveMods();
    const dayThreat = 1 + Math.max(0, state.day - 1) * .025;
    return weightedPick(rng, DB.archetypes, a => {
      let w = a.weight;
      if (a.id !== "innocent") w *= diff.badMult * dayThreat;
      if (a.id === "innocent" && mods.innocent) w *= mods.innocent;
      if (mods[a.id]) w *= mods[a.id];
      return w;
    });
  }

  function fantasyDate(dayOffset = 0) {
    const d = 8 + state.day + dayOffset;
    return "炉历742年·秋月" + clamp(d, 1, 30) + "日";
  }

  function makeCase(index) {
    const rng = rngFor(state.seed + ":day" + state.day + ":case" + index);
    const race = pick(rng, DB.races);
    const profession = pick(rng, DB.professions);
    const origin = pick(rng, DB.origins);
    const archetype = archetypeFor(rng);
    const name = pick(rng, DB.familyNames) + "·" + pick(rng, DB.givenNames);
    const faction = chance(rng, .18) ? "无隶属" : pick(rng, DB.factions);
    const purpose = pick(rng, DB.purposes);
    const age = range(rng, 18, 72);
    const mods = getDirectiveMods();

    const c = {
      id: "BG-" + String(state.day).padStart(2, "0") + String(index + 1).padStart(2, "0") + "-" + String(range(rng, 100, 999)),
      seed: state.seed + "-" + state.day + "-" + index + "-" + name,
      name,
      epithet: chance(rng, .28) ? pick(rng, DB.epithets) : "",
      race,
      profession,
      origin,
      faction,
      purpose,
      age,
      archetype,
      searched: false,
      searchText: "",
      decided: false,
      decision: null,
      visibleClues: [],
      statements: [],
      items: [],
      records: [],
      relations: [],
      doc: null,
      hidden: null,
      disease: null,
      curse: null,
      monster: null,
      speech: ""
    };

    const harmful = archetype.id !== "innocent";
    const forgedBias = archetype.id === "forger" ? .82 : (archetype.id === "spy" || archetype.id === "wanted" ? .26 : .06);
    const docNoise = mods.docNoise ? .11 : 0;
    const hasDocAnomaly = chance(rng, forgedBias + docNoise + (harmful ? .03 : 0));

    const permit = pick(rng, DB.permitTypes);
    const expectedPrefix = origin.seal;
    let serial = expectedPrefix + "-7-" + String(range(rng, 10000, 99999));
    let issuer = pick(rng, DB.issuers);
    let seal = pick(rng, DB.seals);
    let permitName = name;
    let permitAge = age;
    let permitPurpose = purpose;
    let expired = false;
    let anomaly = null;

    if (hasDocAnomaly) {
      const anomalyPool = ["expired","serial","seal","name","age","purpose","issuer"];
      anomaly = pick(rng, anomalyPool);
      if (anomaly === "expired") expired = true;
      if (anomaly === "serial") serial = (chance(rng,.5) ? "XX" : expectedPrefix) + "-" + String(range(rng,10,99)) + "-" + String(range(rng,100,999));
      if (anomaly === "seal") seal = "模糊的未知圆章";
      if (anomaly === "name") permitName = pick(rng, DB.familyNames) + "·" + name.split("·")[1];
      if (anomaly === "age") permitAge = clamp(age + pick(rng, [-7,-5,6,8]), 18, 80);
      if (anomaly === "purpose") permitPurpose = pick(rng, DB.purposes.filter(x => x !== purpose));
      if (anomaly === "issuer") issuer = "旧王道临时文书点";
    }

    c.doc = {
      permit,
      serial,
      issuer,
      seal,
      name: permitName,
      age: permitAge,
      purpose: permitPurpose,
      issued: fantasyDate(-range(rng, 1, 6)),
      expires: expired ? fantasyDate(-1) : fantasyDate(range(rng, 2, 9)),
      expired,
      anomaly
    };

    if (anomaly === "expired") c.visibleClues.push({level:"warning", text:"通行证日期已过期。"});
    if (anomaly === "serial") c.visibleClues.push({level:"warning", text:"证件编号格式与来源地常用格式不完全一致。"});
    if (anomaly === "seal") c.visibleClues.push({level:"warning", text:"印章轮廓模糊，无法直接匹配手册样本。"});
    if (anomaly === "name") c.visibleClues.push({level:"warning", text:"口述姓名与证件登记姓名存在差异。"});
    if (anomaly === "age") c.visibleClues.push({level:"warning", text:"申报年龄与证件年龄相差较大。"});
    if (anomaly === "purpose") c.visibleClues.push({level:"warning", text:"口述目的与证件用途字段不一致。"});
    if (anomaly === "issuer") c.visibleClues.push({level:"neutral", text:"签发机构为临时文书点，档案格式可能不标准。"});

    c.items = sample(rng, DB.commonItems, range(rng, 3, 5));

    const hiddenTypeMap = {
      smuggler:"smuggle", forger:"forge", spy:"spy", cult:"cult", infected:"infected",
      monster:"monster", cursed:"cursed", wanted:"wanted", deserter:"deserter"
    };
    const hiddenType = hiddenTypeMap[archetype.id];
    if (hiddenType && chance(rng, archetype.id === "monster" ? .72 : .66)) {
      const pool = DB.hiddenItems.filter(x => x.type === hiddenType);
      if (pool.length) c.hidden = pick(rng, pool);
    }

    if (archetype.id === "infected") c.disease = pick(rng, DB.diseases);
    if (archetype.id === "cursed") c.curse = pick(rng, DB.curses);
    if (archetype.id === "monster") c.monster = pick(rng, DB.monsterForms);

    c.records = sample(rng, DB.records, range(rng, 2, 4));
    c.relations = sample(rng, DB.relations, range(rng, 1, 3));

    if (archetype.id === "wanted" && chance(rng, .75)) {
      c.records.unshift("档案系统提示：一项旧通缉记录的外貌描述存在部分重合");
      c.visibleClues.push({level:"warning", text:"旧档案中存在未完全排除的身份重合。"});
    }
    if (archetype.id === "deserter" && chance(rng, .68)) {
      c.records.unshift("军务署记录：服役状态待核");
      c.visibleClues.push({level:"warning", text:"军务状态目前无法自动核验。"});
    }
    if (archetype.id === "spy" && chance(rng, .35)) {
      c.relations.unshift("担保人：查无此人");
      c.visibleClues.push({level:"warning", text:"至少一名关系人无法在当前档案中核验。"});
    }

    const claim1 = "“我从" + origin.name + "来，进城是为了" + purpose + "。”";
    const claim2 = pick(rng, DB.claims);
    let claim3 = pick(rng, DB.claims.filter(x => x !== claim2));

    if (harmful && chance(rng, .38)) {
      const contradictions = [
        "“我这半年都没换过住处，档案应该很稳定。”",
        "“我一路独自过来，完全没有加入任何车队。”",
        "“这些东西从出发时起就一直是我自己保管。”",
        "“我最近没有进过医院，也没有经过任何隔离区。”",
        "“这张证件从签发后从没离开过我手里。”"
      ];
      claim3 = pick(rng, contradictions);
      if (chance(rng, .48)) c.visibleClues.push({level:"warning", text:"口供细节与档案/同行信息存在轻微矛盾。"});
    } else if (chance(rng, .28)) {
      c.visibleClues.push({level:"good", text:"路线、职业与大部分携带物之间逻辑一致。"});
    }

    c.statements = [
      {speaker:"入城目的", text:claim1},
      {speaker:"补充说明", text:claim2},
      {speaker:"追问回答", text:claim3}
    ];

    if (!c.visibleClues.length) {
      c.visibleClues.push({level:"neutral", text:"未发现明显证件冲突；仍需结合其他信息判断。"});
    }

    const speechPool = [
      "审查官，我的车队还在外面等。",
      "需要我把箱子都放到台面上吗？",
      "今天队伍真长……我会配合。",
      "我赶时间，但规矩我懂。",
      "证件都在这里，请仔细看。",
      "我只是想进城办完事就走。",
      "外面风很大，能快一点吗？",
      "你们最近是不是查得更严了？"
    ];
    c.speech = "“" + (c.epithet ? c.epithet.replace("的","") + "，" : "") + pick(rng, speechPool) + "”";

    return c;
  }

  function selectDirectives() {
    const rng = rngFor(state.seed + ":directives:" + state.day);
    const candidates = DB.directives.filter(d => d.id !== "calm");
    const count = state.day === 1 ? 1 : 2;
    const chosen = sample(rng, candidates, count);
    if (state.day === 1) chosen.unshift(DB.directives.find(d => d.id === "calm"));
    state.directives = chosen.slice(0, 2);
  }

  function buildDay() {
    const diff = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;
    state.caseIndex = 0;
    state.processed = 0;
    state.pressure = 0;
    state.decisions = [];
    state.pendingEvents = [];
    state.reportReady = false;
    selectDirectives();

    const mods = getDirectiveMods();
    state.searches = Math.max(1, diff.searches + (mods.search || 0));
    state.cells = Math.max(1, diff.cells + (mods.cells || 0));
    const count = Math.min(16, diff.cases + Math.floor((state.day - 1) / 4));
    state.cases = Array.from({ length: count }, (_, i) => makeCase(i));

    const newsRng = rngFor(state.seed + ":news:" + state.day);
    state.currentNews = sample(newsRng, DB.news, 4);
    state.dayStart = {
      gold: state.gold,
      security: state.security,
      economy: state.economy,
      public: state.public,
      threat: state.threat
    };
    save();
    renderAll();
  }

  function currentCase() {
    return state.cases[state.caseIndex] || null;
  }

  function dangerClass(c) {
    if (!c) return "";
    const visibleWarnings = c.visibleClues.filter(x => x.level === "warning").length;
    if (c.searched && (c.hidden || c.archetype.ideal === "isolate")) return "warn";
    if (visibleWarnings >= 2) return "warn";
    return "";
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

  function renderStats() {
    $("goldStat").textContent = Math.round(state.gold);
    $("securityStat").textContent = Math.round(state.security);
    $("economyStat").textContent = Math.round(state.economy);
    $("publicStat").textContent = Math.round(state.public);
    $("securityBar").style.width = clamp(state.security,0,100) + "%";
    $("economyBar").style.width = clamp(state.economy,0,100) + "%";
    $("publicBar").style.width = clamp(state.public,0,100) + "%";
    $("threatBar").style.width = clamp(state.threat,0,100) + "%";
    $("searchStat").textContent = state.searches;
    $("cellStat").textContent = state.cells;

    let threatText = "低";
    if (state.threat >= 55) threatText = "危急";
    else if (state.threat >= 35) threatText = "高";
    else if (state.threat >= 18) threatText = "升高";
    $("threatStat").textContent = threatText;

    $("processedQuota").textContent = state.processed + "/" + state.cases.length;
    $("pendingEvents").textContent = state.pendingEvents.length;
    $("pressureText").textContent = state.pressure < 10 ? "稳定" : state.pressure < 22 ? "上升" : state.pressure < 36 ? "紧张" : "过载";
  }

  function renderHeader() {
    $("dayText").textContent = "第 " + state.day + " 天";
    $("caseCounter").textContent = Math.min(state.caseIndex + 1, state.cases.length) + " / " + state.cases.length;
    $("queueRemaining").textContent = Math.max(0, state.cases.length - state.caseIndex) + " 人";
  }

  function renderDirectives() {
    $("directives").innerHTML = state.directives.map(d =>
      '<div class="directive"><b>' + d.title + '</b><p>' + d.text + '</p></div>'
    ).join("");
  }

  function renderQueue() {
    const upcoming = state.cases.slice(state.caseIndex, state.caseIndex + 5);
    $("queueList").innerHTML = upcoming.map((c, i) =>
      '<div class="queue-person ' + (i === 0 ? "current" : "") + '">' +
      '<span class="queue-avatar">' + c.race.name.slice(0,1) + '</span>' +
      '<b>' + (i === 0 ? c.name : "候检者 " + (state.caseIndex + i + 1)) + '</b>' +
      '<span>' + (i === 0 ? c.profession : c.race.name) + '</span></div>'
    ).join("") || '<div class="muted">今日队列已清空</div>';
  }

  function renderHistory() {
    const list = state.history.slice(0, 6);
    $("decisionLog").innerHTML = list.length ? list.map(h =>
      '<div class="log-entry ' + h.action + '"><b>' + h.label + '</b> · ' + h.name + '<br>' + h.note + '</div>'
    ).join("") : '<div class="muted">尚无记录</div>';
  }

  function renderRulebook() {
    const dynamic = state.directives.map(d => ({title:d.title, text:d.rule}));
    const staticRules = DB.manualRules.slice(0, 4);
    $("rulebook").innerHTML = dynamic.concat(staticRules).slice(0, 6).map(r =>
      '<div class="rule-item"><b>' + r.title + '</b><p>' + r.text + '</p></div>'
    ).join("");
  }

  function renderNews() {
    const times = ["06:40","08:15","10:20","12:05"];
    $("newsFeed").innerHTML = state.currentNews.map((n, i) =>
      '<div class="news-item ' + (i === 0 ? "hot" : "") + '"><span class="news-time">' + (times[i] || "--:--") + '</span><p>' + n + '</p></div>'
    ).join("");
  }

  function renderCase() {
    const c = currentCase();
    if (!c) return;

    $("caseId").textContent = "CASE " + c.id;
    $("npcName").textContent = c.name;
    $("identityTags").innerHTML = [c.race.name, c.profession, c.origin.name, c.faction].map(x => '<span>' + x + '</span>').join("");
    $("riskStamp").textContent = c.searched ? "已搜查" : "未审";
    $("riskStamp").className = "risk-stamp " + dangerClass(c);
    $("npcSpeech").textContent = c.speech;
    $("portrait").innerHTML = portraitSVG(c, false);
    $("miniPortrait").innerHTML = portraitSVG(c, true);

    const f = [
      ["姓名", c.doc.name],["族裔", c.race.name],["年龄", c.doc.age + " 岁"],["职业", c.profession],
      ["来源", c.origin.name],["用途", c.doc.purpose],["类型", c.doc.permit],["有效至", c.doc.expires]
    ];
    $("permitFields").innerHTML = f.map(pair => '<dt>' + pair[0] + '</dt><dd title="' + pair[1] + '">' + pair[1] + '</dd>').join("");
    $("serialCode").textContent = c.doc.serial;
    $("sealMark").textContent = c.doc.seal;
    $("docStatus").textContent = c.doc.expired ? "已过期" : "表面有效";
    $("docStatus").className = "doc-status " + (c.doc.expired ? "bad" : "");

    $("statements").innerHTML = c.statements.map(s =>
      '<div class="statement"><small>' + s.speaker + '</small>' + s.text + '</div>'
    ).join("");

    $("itemCount").textContent = c.items.length + " 项申报";
    $("itemsList").innerHTML = c.items.map(it =>
      '<div class="item-chip"><span class="item-icon">' + it.icon + '</span><span>' + it.name + '</span></div>'
    ).join("");

    if (c.searched) {
      $("searchReveal").classList.remove("hidden");
      $("searchReveal").innerHTML = "<b>搜查结果</b>" + c.searchText;
    } else {
      $("searchReveal").classList.add("hidden");
      $("searchReveal").innerHTML = "";
    }

    $("recordsList").innerHTML = c.records.map((r, i) =>
      '<div class="record-row"><span class="record-year">' + (742 - i) + '</span><span>' + r + '</span></div>'
    ).join("");

    $("relationsList").innerHTML = c.relations.map(r => {
      const sus = /查无|驱逐|在押|失踪|不符|走私|同一住址/.test(r);
      return '<div class="relation-row"><span class="relation-dot ' + (sus ? "sus" : "") + '"></span><span>' + r + '</span></div>';
    }).join("");

    const clues = c.visibleClues.slice();
    if (c.searched) {
      const searchLooksRisky = /异常|疑似|重合|夹层|密信|禁售|未申报|军用|印章|模具|隔离区|拟态|黏液|魔素|倒影|压痕|拆缝|割去|蜕皮|黑色絮状|通缉/.test(c.searchText);
      clues.unshift({
        level: searchLooksRisky ? "warning" : "good",
        text: searchLooksRisky ? "搜查材料出现新的风险信号，需要与证件和口供交叉判断。" : "搜查结果暂未发现高危隐藏项。"
      });
    }
    $("clueBoard").innerHTML = clues.slice(0, 6).map(x =>
      '<div class="clue ' + (x.level === "warning" ? "warning" : x.level === "good" ? "good" : "") + '">' + x.text + '</div>'
    ).join("");

    $("searchBtn").disabled = c.searched || state.searches <= 0;
    $("isolateBtn").disabled = state.cells <= 0;
    $("allowBtn").disabled = false;
    $("rejectBtn").disabled = false;

    const desk = document.querySelector(".main-desk");
    desk.classList.remove("case-transition");
    requestAnimationFrame(() => desk.classList.add("case-transition"));
  }

  function renderAll() {
    renderHeader();
    renderStats();
    renderDirectives();
    renderQueue();
    renderHistory();
    renderRulebook();
    renderNews();
    renderCase();
    $("soundBtn").classList.toggle("active", state.sound);
  }

  function revealSearch(c) {
    const rng = rngFor(c.seed + ":search");
    const lines = [];
    if (c.hidden) lines.push(c.hidden.clue);

    if (c.archetype.id === "monster") {
      lines.push("体征复检：" + pick(rng, DB.bodyAnomalies) + "。");
      if (c.monster) lines.push("魔物学比对提示与“" + c.monster + "”特征部分吻合。");
    } else if (c.archetype.id === "infected") {
      lines.push("体温与淋巴检查异常，症状疑似“" + c.disease + "”。");
      if (chance(rng,.5)) lines.push("衣物上检测到近期隔离区使用的消毒盐残留。");
    } else if (c.archetype.id === "cursed") {
      lines.push("魔素复检出现持续脉冲，疑似“" + c.curse + "”。");
      if (chance(rng,.55)) lines.push("镜面测试出现短暂的倒影延迟。");
    } else if (c.archetype.id === "forger" && !c.hidden) {
      lines.push("纸张纤维与宣称的签发批次不一致，边缘可见二次压印。");
    } else if (c.archetype.id === "spy" && !c.hidden) {
      lines.push("衣物夹层发现被反复拆缝的痕迹，但没有直接查获密件。");
    } else if (c.archetype.id === "wanted" && !c.hidden) {
      lines.push("指纹与一份旧案残缺指纹存在部分重合，需要人工复核。");
    } else if (c.archetype.id === "deserter" && !c.hidden) {
      lines.push("肩部有近期长期佩戴制式护甲留下的压痕。");
    } else if (c.archetype.id === "cult" && !c.hidden) {
      lines.push("随身祷告册有数页被整齐割去，未直接发现违禁符号。");
    }

    if (!lines.length) lines.push(pick(rng, DB.searchCluesBenign));
    return lines.join(" ");
  }

  function showToast(text, tone = "") {
    const t = $("toast");
    t.textContent = text;
    t.className = "toast show " + tone;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.className = "toast", 2100);
  }

  function logAction(c, action, note) {
    const labels = {allow:"放行",reject:"拒绝",search:"搜查",isolate:"隔离"};
    state.history.unshift({name:c.name, action, label:labels[action], note});
    state.history = state.history.slice(0, 30);
  }

  function doSearch() {
    const c = currentCase();
    if (!c || c.decided) return;
    if (c.searched) return showToast("此人已经搜查过。");
    if (state.searches <= 0) return showToast("今日搜查令已经用完。","bad");

    state.searches -= 1;
    state.gold -= 1;
    state.pressure += 4;
    c.searched = true;
    c.searchText = revealSearch(c);
    logAction(c, "search", "追加搜查，案件继续审理");
    audio.sfx("search");
    showToast("搜查完成：新的材料已加入案卷。");
    renderAll();
    save();
  }

  function applyDelta(delta) {
    const diff = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;
    const p = diff.penalty;
    if (delta.gold) state.gold += delta.gold < 0 ? delta.gold * p : delta.gold;
    if (delta.security) state.security += delta.security < 0 ? delta.security * p : delta.security;
    if (delta.economy) state.economy += delta.economy < 0 ? delta.economy * p : delta.economy;
    if (delta.public) state.public += delta.public < 0 ? delta.public * p : delta.public;
    if (delta.threat) state.threat += delta.threat;

    state.security = clamp(state.security, 0, 100);
    state.economy = clamp(state.economy, 0, 100);
    state.public = clamp(state.public, 0, 100);
    state.threat = clamp(state.threat, 0, 100);
  }

  function queueIncident(c, action, correct) {
    const rng = rngFor(c.seed + ":incident:" + action);
    let key = null;
    if (c.archetype.id === "innocent" && action === "allow") key = "innocent_allow";
    else if (c.archetype.id === "innocent" && action === "reject") key = "innocent_reject";
    else if (c.archetype.id === "innocent" && action === "isolate") key = "innocent_isolate";
    else if (!correct && action === "allow") {
      if (["smuggler","forger","wanted","deserter","cult"].includes(c.archetype.id)) key = "smuggler_allow";
      if (c.archetype.id === "spy") key = "spy_allow";
      if (c.archetype.id === "monster") key = "monster_allow";
      if (c.archetype.id === "infected") key = "infected_allow";
      if (c.archetype.id === "cursed") key = "cursed_allow";
    } else if (correct && c.archetype.id !== "innocent") key = "threat_stopped";

    if (!key || !DB.incidentTemplates[key]) return;
    let text = pick(rng, DB.incidentTemplates[key]);
    text = text.replaceAll("{name}", c.name).replaceAll("{profession}", c.profession);
    state.pendingEvents.push({caseId:c.id, text, good:correct, type:key, danger:c.archetype.danger, applied:false});
  }

  function evaluateDecision(c, action) {
    const ideal = c.archetype.ideal;
    const correct = action === ideal;
    const mods = getDirectiveMods();
    let delta = {gold:0,security:0,economy:0,public:0,threat:0};

    if (c.archetype.id === "innocent") {
      if (action === "allow") delta = {gold:2,economy:4*(mods.economyReward||1),public:2,security:.4,threat:-.2};
      else if (action === "reject") delta = {gold:-2,economy:-5*(mods.economyPenalty||1),public:-6*(mods.publicPenalty||1),security:.5,threat:-.2};
      else if (action === "isolate") delta = {gold:-4,economy:-2,public:-10*(mods.publicPenalty||1),security:.8,threat:-.3};
    } else if (ideal === "reject") {
      if (action === "reject") delta = {gold:.5,security:2+c.archetype.danger*.8,economy:-.6,public:.5,threat:-2};
      else if (action === "allow") delta = {gold:1,security:-(2+c.archetype.danger*1.8),economy:1,public:-1,threat:3+c.archetype.danger*1.3};
      else if (action === "isolate") delta = {gold:-3,security:1.5+c.archetype.danger*.4,economy:-1,public:-3,threat:-1};
    } else if (ideal === "isolate") {
      if (action === "isolate") delta = {gold:-2,security:6+c.archetype.danger,economy:-.5,public:1,threat:-5};
      else if (action === "reject") delta = {gold:-1,security:-1.5,economy:-.5,public:-1,threat:1.5};
      else if (action === "allow") delta = {gold:.5,security:-(7+c.archetype.danger*2.2),economy:-2,public:-3,threat:8+c.archetype.danger*1.7};
    }

    if (c.searched) {
      state.pressure += 1;
      if (correct) delta.security += .8;
    }
    applyDelta(delta);
    return {correct, ideal, delta};
  }

  function finalize(action) {
    const c = currentCase();
    if (!c || c.decided) return;
    if (action === "isolate" && state.cells <= 0) return showToast("隔离区已满，无法执行隔离。","bad");
    if (action === "isolate") state.cells -= 1;

    c.decided = true;
    c.decision = action;
    state.processed += 1;
    state.pressure += action === "isolate" ? 3 : 1;

    const result = evaluateDecision(c, action);
    queueIncident(c, action, result.correct);

    const actionLabel = {allow:"放行",reject:"拒绝",isolate:"隔离"}[action];
    logAction(c, action, "已盖章 · " + c.id);
    state.decisions.push({
      caseId:c.id, name:c.name, action, correct:result.correct, ideal:result.ideal,
      truth:c.archetype.label, searched:c.searched
    });

    audio.sfx(action);
    $("riskStamp").textContent = actionLabel;
    $("riskStamp").classList.add("stamp-pop");

    if (action === "allow") showToast("放行章已落下。后果可能不会立刻出现。","good");
    if (action === "reject") showToast("拒绝入城，档案已封存。");
    if (action === "isolate") showToast("目标已移交隔离区。");

    setTimeout(() => {
      state.caseIndex += 1;
      if (state.caseIndex >= state.cases.length) endDay();
      else {
        renderAll();
        save();
      }
    }, 330);
  }

  function processIncidents() {
    state.pendingEvents.forEach(ev => {
      if (ev.applied) return;
      if (!ev.good) {
        if (/monster|infected|cursed/.test(ev.type)) applyDelta({security:-2.5,public:-1.2,threat:2.5});
        else if (/spy/.test(ev.type)) applyDelta({security:-2,threat:1.5});
        else if (/smuggler/.test(ev.type)) applyDelta({gold:-1,economy:-.8,security:-1,threat:.5});
        else if (/innocent_reject|innocent_isolate/.test(ev.type)) applyDelta({public:-1,economy:-.5});
      } else {
        if (/innocent_allow/.test(ev.type)) applyDelta({gold:1,economy:.7});
        else applyDelta({security:.5,threat:-.5});
      }
      ev.applied = true;
    });
  }

  function auditSample() {
    const rng = rngFor(state.seed + ":audit:" + state.day);
    return sample(rng, state.decisions, Math.min(4, state.decisions.length));
  }

  function endDay() {
    processIncidents();
    state.reportReady = true;

    // 最后一枚印章落下后先刷新桌面背景，避免日结蒙层后面的队列仍停留在前一帧。
    renderHeader();
    renderStats();
    renderQueue();
    renderHistory();

    const start = state.dayStart;
    const deltas = {
      gold:state.gold-start.gold, security:state.security-start.security, economy:state.economy-start.economy,
      public:state.public-start.public, threat:state.threat-start.threat
    };

    $("reportTitle").textContent = "第 " + state.day + " 天值勤报告";
    const stats = [["城库",deltas.gold,"G"],["治安",deltas.security,""],["经济",deltas.economy,""],["民意",deltas.public,""],["警戒",deltas.threat,""]];
    $("reportStats").innerHTML = stats.map(row => {
      const k=row[0], v=row[1], u=row[2], rounded=Math.round(v*10)/10;
      const cls = (k === "警戒" ? rounded <= 0 : rounded >= 0) ? "up" : "down";
      return '<div class="report-stat"><span>' + k + '</span><b class="' + cls + '">' + (rounded>0?"+":"") + rounded + u + '</b></div>';
    }).join("");

    const events = state.pendingEvents.length ? state.pendingEvents : [{text:"今日未触发可追溯的延迟事件。",good:true}];
    $("eventReport").innerHTML = events.slice(0,8).map(e => '<div class="event-line ' + (e.good?"good":"bad") + '">' + e.text + '</div>').join("");

    const audits = auditSample();
    $("auditReport").innerHTML = audits.map(a => {
      const actionName = {allow:"放行",reject:"拒绝",isolate:"隔离"}[a.action];
      const idealName = {allow:"放行",reject:"拒绝",isolate:"隔离"}[a.ideal];
      return '<div class="audit-line ' + (a.correct?"good":"bad") + '">' + a.name + ' · 实际身份：<b>' + a.truth + '</b><br>你的处置：' + actionName + (a.searched?"（搜查后）":"") + ' · 建议处置：' + idealName + '</div>';
    }).join("");

    const correct = state.decisions.filter(x => x.correct).length;
    const accuracy = Math.round(correct / Math.max(1,state.decisions.length) * 100);
    let comment = "今日抽样与系统复核显示，最终处置准确率约为 " + accuracy + "%。";
    if (state.economy < 30) comment += " 商路已经非常脆弱，继续大量误拒可能导致市场停摆。";
    if (state.security < 30) comment += " 城防处于高压状态，危险目标带来的代价正在累积。";
    if (state.public < 30) comment += " 民意接近失控，强制措施需要更扎实的证据。";
    if (state.threat > 55) comment += " 渗透警戒已进入危急区间。";
    $("reportComment").textContent = comment;

    const collapsed = state.security <= 0 || state.economy <= 0 || state.public <= 0 || state.threat >= 100 || state.gold <= -30;
    const finalDay = state.day >= CAMPAIGN_DAYS;
    state.campaignEnded = collapsed || finalDay;

    if (state.campaignEnded) {
      const score = Math.round((state.security + state.economy + state.public + (100-state.threat))/4);
      const rank = (DB.rankNames.find(r => score >= r.min) || DB.rankNames[DB.rankNames.length-1]).name;
      $("reportTitle").textContent = collapsed ? "任期中止 · 黑门紧急接管" : "第 " + CAMPAIGN_DAYS + " 天 · 任期结算";
      $("reportComment").textContent = collapsed ?
        "城邦指标突破了安全下限，你的值勤被紧急接管。最终综合评分 " + score + "，记录称号：" + rank + "。" :
        "你完成了 " + CAMPAIGN_DAYS + " 天任期。最终综合评分 " + score + "，记录称号：" + rank + "。";
      $("nextDayBtn").textContent = "结束任期 · 返回任命书";
    } else {
      $("nextDayBtn").textContent = "领取次日审查令";
    }

    $("dayOverlay").classList.add("active");
    audio.sfx("day");
    save();
  }

  function nextDay() {
    $("dayOverlay").classList.remove("active");
    if (state.campaignEnded) {
      localStorage.removeItem(STORAGE_KEY);
      $("startOverlay").classList.add("active");
      $("continueBtn").classList.add("hidden");
      return;
    }
    state.day += 1;
    buildDay();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { console.warn("Save failed", e); }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) return false;
      state = parsed;
      selectedDifficulty = state.difficulty || "normal";
      audio.enabled = state.sound !== false;
      return true;
    } catch (e) {
      console.warn("Load failed", e);
      return false;
    }
  }

  function startNew() {
    audio.start();
    state = freshState();
    state.difficulty = selectedDifficulty;
    state.sound = true;
    audio.enabled = true;
    $("startOverlay").classList.remove("active");
    buildDay();
  }

  function continueGame() {
    audio.start();
    if (!load()) return startNew();
    $("startOverlay").classList.remove("active");
    renderAll();
    if (state.reportReady) $("dayOverlay").classList.add("active");
  }

  function toggleSound() {
    audio.start();
    state.sound = !state.sound;
    audio.setEnabled(state.sound);
    $("soundBtn").classList.toggle("active", state.sound);
    showToast(state.sound ? "地下城环境音乐已开启。" : "音乐与音效已关闭。");
    save();
  }

  function bindEvents() {
    document.querySelectorAll("[data-difficulty]").forEach(btn => {
      btn.addEventListener("click", () => {
        selectedDifficulty = btn.dataset.difficulty;
        document.querySelectorAll("[data-difficulty]").forEach(x => x.classList.toggle("selected", x === btn));
      });
    });

    $("startBtn").addEventListener("click", startNew);
    $("continueBtn").addEventListener("click", continueGame);
    $("allowBtn").addEventListener("click", () => finalize("allow"));
    $("rejectBtn").addEventListener("click", () => finalize("reject"));
    $("searchBtn").addEventListener("click", doSearch);
    $("isolateBtn").addEventListener("click", () => finalize("isolate"));
    $("nextDayBtn").addEventListener("click", nextDay);
    $("soundBtn").addEventListener("click", toggleSound);
    $("helpBtn").addEventListener("click", () => $("helpOverlay").classList.add("active"));
    $("closeHelpBtn").addEventListener("click", () => $("helpOverlay").classList.remove("active"));
    $("helpOverlay").addEventListener("click", e => { if (e.target === $("helpOverlay")) $("helpOverlay").classList.remove("active"); });

    $("restartBtn").addEventListener("click", () => {
      if (confirm("确定结束当前任期并重新开始吗？本地存档会被清除。")) {
        localStorage.removeItem(STORAGE_KEY);
        state = freshState();
        $("dayOverlay").classList.remove("active");
        $("helpOverlay").classList.remove("active");
        $("startOverlay").classList.add("active");
        $("continueBtn").classList.add("hidden");
      }
    });

    window.addEventListener("keydown", e => {
      if ($("startOverlay").classList.contains("active") || $("dayOverlay").classList.contains("active") || $("helpOverlay").classList.contains("active")) return;
      if (e.key === "1") finalize("allow");
      if (e.key === "2") finalize("reject");
      if (e.key === "3") doSearch();
      if (e.key === "4") finalize("isolate");
    });
  }

  function initialPaint() {
    const hasSave = !!localStorage.getItem(STORAGE_KEY);
    $("continueBtn").classList.toggle("hidden", !hasSave);

    const previewRng = rngFor("blackgate-preview");
    const preview = {
      name:"黑门候检者", race:pick(previewRng, DB.races), profession:"商旅",
      origin:pick(previewRng, DB.origins), faction:"黑门商会", seed:"preview"
    };
    $("portrait").innerHTML = portraitSVG(preview, false);
    bindEvents();
  }

  initialPaint();
})();
