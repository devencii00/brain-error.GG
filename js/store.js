/* ==========================================================
   BrainError | data layer + grading engine
   Uses localStorage. Falls back gracefully if blocked.
   ========================================================== */
const DB = (() => {
  const K = {
    users: 'be_users',
    session: 'be_session',
    quizzes: 'be_quizzes',
    attempts: 'be_attempts',
    seeded: 'be_seeded_v2',
    guest: 'be_guest_id',
    adminCode: 'be_admin_code',
  };
  const DEFAULT_ADMIN_CODE = 'BRAIN-ADMIN';

  const read = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  };
  const write = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch { return false; }
  };
  const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  const fakeHash = (s) => { try { return btoa(unescape(encodeURIComponent(s))); } catch { return s; } };

  const adminCode = () => read(K.adminCode, DEFAULT_ADMIN_CODE);

  /* ---------- seed sample quiz ---------- */
  function sampleQuiz() {
    const now = Date.now();
    return {
      id: 'quiz_esp32_units',
      title: 'ESP32 & IoT | Units 1–10 Reviewer',
      subject: 'IoT',
      description: 'Full reviewer covering breadboarding, IoT, digital I/O, buttons, potentiometers, LDR, LCD I2C, ultrasonic, servo, and 7-segment displays.',
      settings: { reveal: true, shuffleQuestions: false, shuffleChoices: true, timers: { mcq: 10, ident: 5, enum: 20, code: 60 }, timerEnabled: false },
      createdBy: 'seed',
      createdAt: now,
      updatedAt: now,
      sections: [
        {
          id: uid('s'), type: 'mcq', title: 'Multiple Choice',
          questions: [
            { id: uid('q'), type: 'mcq', q: 'What does LDR stand for?', choices: ['Light Dependent Resistor', 'Low Digital Resistor', 'Logic Data Reader', 'Light Diode Receiver'], answer: 0, explain: 'LDR = Light Dependent Resistor, also called photoresistor.' },
            { id: uid('q'), type: 'mcq', q: 'Which pin is typically the wiper/signal pin on a potentiometer?', choices: ['VCC', 'GND', 'Middle pin', 'Any pin'], answer: 2, explain: 'The middle pin produces the variable voltage.' },
            { id: uid('q'), type: 'mcq', q: 'How many wires does an I2C LCD need for communication?', choices: ['1', '2', '4', '8'], answer: 1, explain: 'I2C uses SDA and SCL | just 2 lines.' },
            { id: uid('q'), type: 'mcq', q: 'A 7-segment display in COMMON CATHODE turns a segment ON with:', choices: ['HIGH (1)', 'LOW (0)', 'Any voltage', 'PWM only'], answer: 0, explain: 'Common Cathode: HIGH turns ON. Common Anode: LOW turns ON.' },
            { id: uid('q'), type: 'mcq', q: 'What frequency does a standard servo PWM signal use?', choices: ['1 Hz', '50 Hz', '60 Hz', '1000 Hz'], answer: 1, explain: 'Standard is 50 Hz (20 ms period).' },
          ],
        },
        {
          id: uid('s'), type: 'ident', title: 'Identification',
          questions: [
            { id: uid('q'), type: 'ident', q: 'Component whose resistance decreases as light intensity increases.', answer: 'LDR', alts: ['Light Dependent Resistor', 'Photoresistor', 'Photocell', 'Light Sensor'], explain: 'More light = lower resistance.' },
            { id: uid('q'), type: 'ident', q: 'Microcontroller developed by Espressif with built-in Wi-Fi and Bluetooth.', answer: 'ESP32', alts: ['Espressif ESP32'], explain: 'ESP32 = the brain of IoT projects.' },
            { id: uid('q'), type: 'ident', q: 'Protocol that uses SDA and SCL lines.', answer: 'I2C', alts: ['IIC', 'I²C', 'Inter-Integrated Circuit'], explain: 'Two-wire serial protocol.' },
            { id: uid('q'), type: 'ident', q: 'Sensor that measures distance using 40 kHz sound waves.', answer: 'Ultrasonic Sensor', alts: ['HC-SR04', 'Ultrasonic'], explain: 'Uses TRIG + ECHO pins.' },
          ],
        },
        {
          id: uid('s'), type: 'enum', title: 'Enumeration',
          questions: [
            { id: uid('q'), type: 'enum', q: 'List the 4 layers of the IoT ecosystem.', answers: ['Sensors', 'Connectivity', 'Data Processing', 'User Interface'], ordered: false, explain: 'Sensors → Connectivity → Processing → UI.' },
            { id: uid('q'), type: 'enum', q: 'Name the 3 terminals of a potentiometer.', answers: ['VCC', 'GND', 'Wiper'], ordered: false, explain: 'Wiper is the middle/signal pin.' },
            { id: uid('q'), type: 'enum', q: 'List the wire colors of a typical servo motor and what each does.', answers: ['Brown GND', 'Red VCC', 'Orange PWM'], ordered: false, explain: 'Brown=GND, Red=VCC, Orange=PWM signal.' },
          ],
        },
        {
          id: uid('s'), type: 'code', title: 'Code Challenge',
          questions: [
            { id: uid('q'), type: 'code', mode: 'blank', language: 'cpp', title: 'Fill in the blanks', prompt: 'Complete the pin setup for a button input and LED output.', code: 'void setup() {\n  pinMode(BUTTON_PIN, [[INPUT]]);\n  pinMode(LED_PIN, [[OUTPUT]]);\n}', bugLine: null, fix: '', explain: 'INPUT for reading, OUTPUT for driving.' },
            { id: uid('q'), type: 'code', mode: 'bug', language: 'cpp', title: 'Find the bug', prompt: 'Click the line with the bug, then type the corrected line.', code: 'void loop() {\n  int s = digitalRead(4);\n  if (s = HIGH) {\n    digitalWrite(2, HIGH);\n  }\n}', bugLine: 3, fix: 'if (s == HIGH) {', explain: '`=` is assignment; `==` is comparison.' },
            { id: uid('q'), type: 'code', mode: 'syntax', language: 'cpp', title: 'Fix the syntax', prompt: 'The code below has a syntax error. Type the corrected code.', code: 'void setup() {\n  pinMode(2, OUTPUT)\n}', bugLine: null, fix: 'void setup() {\n  pinMode(2, OUTPUT);\n}', explain: 'Missing semicolon after the pinMode call.' },
            { id: uid('q'), type: 'code', mode: 'arrange', language: 'cpp', title: 'Arrange the code', prompt: 'Put the lines in the correct order.', code: 'void setup() {\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  Serial.println("Hello");\n  delay(1000);\n}', bugLine: null, fix: '', explain: 'setup() first, then loop().' },
          ],
        },
      ],
    };
  }

  /* ---------- users / session ---------- */
  function ensureUsers() {
    const users = read(K.users, []);
    if (!users.length) {
      users.push({ id: uid('u'), name: 'Demo Admin', email: 'admin@brainerror.app', pass: fakeHash('admin123'), role: 'admin', createdAt: Date.now() });
      write(K.users, users);
    }
    return users;
  }
  const setSession = (u) => write(K.session, { id: u.id, name: u.name, email: u.email || '', role: u.role, guest: !!u.guest });

  const api = {
    uid,
    ADMIN_CODE: DEFAULT_ADMIN_CODE,
    adminCode,

    session: () => read(K.session, null),

    register({ name, email, password, adminCode: code }) {
      const users = ensureUsers();
      email = String(email || '').trim().toLowerCase();
      if (users.some((u) => u.email === email)) throw new Error('An account with this email already exists.');
      let role = 'user';
      if (code) {
        if (code.trim() !== adminCode()) throw new Error('Invalid admin access code.');
        role = 'admin';
      }
      const u = { id: uid('u'), name: name.trim(), email, pass: fakeHash(password), role, createdAt: Date.now() };
      users.push(u); write(K.users, users); setSession(u);
      return u;
    },

    login({ email, password }) {
      const users = ensureUsers();
      email = String(email || '').trim().toLowerCase();
      const u = users.find((x) => x.email === email && x.pass === fakeHash(password));
      if (!u) throw new Error('Incorrect email or password.');
      setSession(u);
      return u;
    },

    guest() {
      let id = read(K.guest, null);
      if (!id) { id = uid('guest'); write(K.guest, id); }
      const u = { id, name: 'Guest', role: 'user', guest: true };
      setSession(u);
      return u;
    },

    logout() { try { localStorage.removeItem(K.session); } catch {} },

    updateAdminCode(newCode) {
      if (!newCode || newCode.length < 4) throw new Error('Code must be at least 4 characters.');
      write(K.adminCode, newCode);
    },

    /* ---------- quizzes ---------- */
    quizzes: () => read(K.quizzes, []),
    quiz: (id) => read(K.quizzes, []).find((q) => q.id === id) || null,
  saveQuiz(quiz) {
  const list = read(K.quizzes, []);
  const now = Date.now();
  // ensure timers exist with defaults
  if (!quiz.settings) quiz.settings = {};
  if (!quiz.settings.timers) quiz.settings.timers = { mcq: 10, ident: 5, enum: 20, code: 60 };
  if (typeof quiz.settings.timerEnabled !== 'boolean') quiz.settings.timerEnabled = false;
  const i = list.findIndex((q) => q.id === quiz.id);
  if (i >= 0) { list[i] = { ...quiz, updatedAt: now }; }
  else { list.unshift({ ...quiz, id: quiz.id || uid('quiz'), createdAt: now, updatedAt: now }); }
  if (!write(K.quizzes, list)) throw new Error('Could not save (browser storage is full or blocked).');
  return i >= 0 ? list[i] : list[0];
},
    removeQuiz(id) { write(K.quizzes, read(K.quizzes, []).filter((q) => q.id !== id)); },
    duplicateQuiz(id) {
      const src = api.quiz(id); if (!src) return null;
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = uid('quiz'); copy.title += ' (copy)';
      copy.sections.forEach((s) => { s.id = uid('s'); s.questions.forEach((q) => (q.id = uid('q'))); });
      return api.saveQuiz(copy);
    },

    /* ---------- attempts ---------- */
    attempts: (userId) => read(K.attempts, []).filter((a) => a.userId === userId).sort((a, b) => b.at - a.at),
    addAttempt(a) { const list = read(K.attempts, []); list.push({ ...a, id: uid('a'), at: Date.now() }); write(K.attempts, list); },
    clearAttempts(userId) { write(K.attempts, read(K.attempts, []).filter((a) => a.userId !== userId)); },

    /* ---------- import / export ---------- */
    exportData: () => ({ app: 'BrainError', version: 2, exportedAt: new Date().toISOString(), quizzes: read(K.quizzes, []) }),
    importData(obj, { replace = false } = {}) {
      const incoming = Array.isArray(obj) ? obj : obj && Array.isArray(obj.quizzes) ? obj.quizzes : null;
      if (!incoming) throw new Error('File is not a valid BrainError export.');
      const list = replace ? [] : read(K.quizzes, []);
      let n = 0;
      incoming.forEach((q) => {
        if (!q || !q.title || !Array.isArray(q.sections)) return;
        const i = list.findIndex((x) => x.id === q.id);
        if (i >= 0) list[i] = q; else list.push({ ...q, id: q.id || uid('quiz') });
        n++;
      });
      write(K.quizzes, list);
      return n;
    },

    async loadRepoData({ replace = false } = {}) {
      const res = await fetch('data/quizzes.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('data/quizzes.json not found.');
      return api.importData(await res.json(), { replace });
    },

    async init() {
      ensureUsers();
      if (read(K.seeded, false)) return;
      let loaded = 0;
      try { loaded = await api.loadRepoData(); } catch { /* offline or file:// */ }
      if (!loaded) write(K.quizzes, [sampleQuiz()]);
      write(K.seeded, true);
    },
  };
  return api;
})();

/* ==========================================================
   Code normalization | ignores whitespace, comments, strings
   ========================================================== */
function normalizeCode(src, lang = 'javascript') {
  lang = String(lang || '').toLowerCase();
  const hash = ['python', 'ruby', 'bash', 'php'].includes(lang);
  const slash = !['python', 'ruby', 'bash', 'sql', 'html'].includes(lang);
  const strings = [];
  if (lang === 'python') strings.push('"""[\\s\\S]*?"""', "'''[\\s\\S]*?'''");
  strings.push('"(?:\\\\.|[^"\\\\\\n])*"', "'(?:\\\\.|[^'\\\\\\n])*'");
  if (lang !== 'python' && lang !== 'sql') strings.push('`(?:\\\\.|[^`\\\\])*`');
  const comments = [];
  if (slash || lang === 'sql') comments.push('\\/\\*[\\s\\S]*?\\*\\/');
  if (slash) comments.push('\\/\\/[^\\n]*');
  if (hash) comments.push('#[^\\n]*');
  if (lang === 'sql') comments.push('--[^\\n]*');
  if (lang === 'html') comments.push('<!--[\\s\\S]*?-->');
  const re = new RegExp('(' + strings.join('|') + ')' + (comments.length ? '|' + comments.join('|') : ''), 'g');
  return String(src == null ? '' : src)
    .replace(re, (m, str) => (str && !/^("""|''')/.test(str) ? str[0] + str[0] : ''))
    .replace(/\s+/g, '')
    .replace(/;+$/, '');
}