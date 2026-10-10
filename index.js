const TelegramBot = require('node-telegram-bot-api');
const Database = require('better-sqlite3');

const bot = new TelegramBot('8842389631:AAEqiAWcimYaFiunhmXzyrbNpEIu0BuPmPU', { polling: true });
const db = new Database('bot.db');

const ADMIN_ID = 8690698115;
const REWARD = 5;    // ဖိတ်ခေါ်တစ်ယောက် = credit
const KEY_COST = 5;  // key တစ်ခု = credit
const REQUIRED = [
  { id: '@arsar2027', link: 'https://t.me/arsar2027', name: 'Group' },
];
const GROUP_LINK = 'https://t.me/arsar2027';
const PAGE = 8;

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  credits INTEGER DEFAULT 0,
  referred_by INTEGER,
  verified INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE,
  used_by INTEGER,
  used_at TEXT
);`);

let BOT_USERNAME = '';
bot.getMe().then((me) => (BOT_USERNAME = me.username));
bot.on('polling_error', (e) => console.log('polling_error:', e.message));
process.on('unhandledRejection', (e) => console.log('unhandled:', e && e.message));

// Admin က ဘာစာစောင့်နေလဲ မှတ်ထားတဲ့နေရာ
let adminState = null;

// ================= Helpers =================
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getUser = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);
const count = (sql, ...p) => db.prepare(sql).get(...p).c;
const creditText = (uid, u) => (uid === ADMIN_ID ? '♾ Unlimited' : u.credits);

function keyLabel(k) {
  const h = k.indexOf('#');
  if (h !== -1) {
    try { return decodeURIComponent(k.slice(h + 1)).slice(0, 20); } catch (e) {}
  }
  return k.slice(8, 16) + '…';
}

function ensureUser(uid, text = '') {
  if (getUser(uid)) return;
  const m = text.match(/^\/start ref_(\d+)/);
  let ref = m ? Number(m[1]) : null;
  if (ref === uid || !getUser(ref)) ref = null;
  db.prepare('INSERT INTO users (id, referred_by) VALUES (?, ?)').run(uid, ref);
}

async function show(chatId, messageId, text, keyboard) {
  const opts = {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: keyboard },
  };
  if (messageId) {
    try {
      return await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
    } catch (e) {
      if (String(e.message).includes('not modified')) return;
    }
  }
  return bot.sendMessage(chatId, text, opts);
}

// ================= Join စစ်ခြင်း =================
async function inChat(chatId, userId) {
  try {
    const m = await bot.getChatMember(chatId, userId);
    return ['member', 'administrator', 'creator'].includes(m.status);
  } catch (e) {
    return false;
  }
}
async function missingChats(userId) {
  const r = await Promise.all(
    REQUIRED.map(async (c) => ((await inChat(c.id, userId)) ? null : c))
  );
  return r.filter(Boolean);
}
function onVerified(uid) {
  const u = getUser(uid);
  if (!u || u.verified) return;
  db.prepare('UPDATE users SET verified=1 WHERE id=?').run(uid);
  if (u.referred_by) {
    db.prepare('UPDATE users SET credits=credits+? WHERE id=?').run(REWARD, u.referred_by);
    bot.sendMessage(u.referred_by, `🎉 သူငယ်ချင်း Join ပြီးပါပြီ!\n💰 +${REWARD} credit ရပါပြီ`).catch(() => {});
  }
}

// ================= User Screens =================
const backRow = [{ text: '🏠 မူလစာမျက်နှာ', callback_data: 'menu' }];

function screenJoin(chatId, mid, missing) {
  const rows = missing.map((c) => [{ text: `📢 ${c.name} Join မယ်`, url: c.link }]);
  rows.push([{ text: '✅ Join ပြီးပါပြီ', callback_data: 'check_join' }]);
  return show(
    chatId, mid,
    '🔒 <b>Bot သုံးဖို့ Join ရပါမယ်</b>\n\nအောက်က Group ကို Join ပြီး <b>✅ Join ပြီးပါပြီ</b> ကိုနှိပ်ပါ။\n⚠️ ထွက်သွားရင် Bot သုံးခွင့် ပိတ်ပါမယ်။',
    rows
  );
}

function screenMenu(chatId, mid, uid) {
  const u = getUser(uid);
  const stock = count('SELECT COUNT(*) c FROM keys WHERE used_by IS NULL');
  const kb = [
    [{ text: '🔑 Free VLESS Key ယူမယ်', callback_data: 'getkey' }],
    [
      { text: '💰 My Account', callback_data: 'credit' },
      { text: '👥 ဖိတ်ခေါ်မယ်', callback_data: 'invite' },
    ],
    [{ text: '📢 Group', url: GROUP_LINK }],
  ];
  if (uid === ADMIN_ID) kb.push([{ text: '🛠 Admin Panel', callback_data: 'adm_panel' }]);
  return show(
    chatId, mid,
    `✨ <b>ကြိုဆိုပါတယ်!</b>\n\n💰 Credit: <b>${creditText(uid, u)}</b>\n🔑 Key လက်ကျန်: <b>${stock}</b>\n\nအောက်က ခလုတ်တွေကို နှိပ်ပါ 👇`,
    kb
  );
}

function screenCredit(chatId, mid, uid) {
  const u = getUser(uid);
  const invited = count('SELECT COUNT(*) c FROM users WHERE referred_by=? AND verified=1', uid);
  const got = count('SELECT COUNT(*) c FROM keys WHERE used_by=?', uid);
  return show(
    chatId, mid,
    `👤 <b>My Account</b>\n\n🆔 ID: <code>${uid}</code>\n💰 Credit: <b>${creditText(uid, u)}</b>\n👥 ဖိတ်ခေါ်ပြီးသူ: <b>${invited}</b>\n🔑 ယူပြီး Key: <b>${got}</b>\n\n🎁 ${KEY_COST} credit = Key ၁ ခု`,
    [
      [{ text: '🔑 Key ယူမယ်', callback_data: 'getkey' }, { text: '👥 ဖိတ်ခေါ်မယ်', callback_data: 'invite' }],
      backRow,
    ]
  );
}

function screenInvite(chatId, mid, uid) {
  const link = `https://t.me/${BOT_USERNAME}?start=ref_${uid}`;
  const share =
    'https://t.me/share/url?url=' + encodeURIComponent(link) +
    '&text=' + encodeURIComponent('🎁 Free VLESS Key ရယူဖို့ ဒီ Bot ကိုသုံးကြည့်ပါ');
  return show(
    chatId, mid,
    `👥 <b>သူငယ်ချင်းခေါ်ပြီး Credit ရယူပါ</b>\n\nတစ်ယောက် Join တိုင်း <b>+${REWARD} credit</b> 🎉\n\n🔗 သင့် Link:\n<code>${link}</code>\n\n📢 Group: ${GROUP_LINK}`,
    [[{ text: '📤 Share လုပ်မယ်', url: share }], backRow]
  );
}

function screenConfirm(chatId, mid, uid) {
  const u = getUser(uid);
  if (uid !== ADMIN_ID && u.credits < KEY_COST) {
    return show(
      chatId, mid,
      `❌ <b>Credit မလောက်ပါ</b>\n\nလိုအပ်: <b>${KEY_COST}</b>\nရှိတာ: <b>${u.credits}</b>\n\nသူငယ်ချင်းခေါ်ပြီး Credit ရယူပါ 👇`,
      [[{ text: '👥 ဖိတ်ခေါ်မယ်', callback_data: 'invite' }], backRow]
    );
  }
  const costText = uid === ADMIN_ID ? 'Credit မနှုတ်ပါ (Admin)' : `<b>${KEY_COST} credit</b> သုံးပြီး`;
  return show(
    chatId, mid,
    `🔑 ${costText} Key တစ်ခု ယူမလား?`,
    [[
      { text: '✅ ယူမယ်', callback_data: 'confirm_key' },
      { text: '❌ မယူတော့ပါ', callback_data: 'menu' },
    ]]
  );
}

// Key ယူခြင်း (Admin က credit မနှုတ်)
const claimKey = db.transaction((uid) => {
  const isAdmin = uid === ADMIN_ID;
  const u = getUser(uid);
  if (!isAdmin && u.credits < KEY_COST) return { err: 'credit' };
  const k = db.prepare('SELECT id, key FROM keys WHERE used_by IS NULL ORDER BY id LIMIT 1').get();
  if (!k) return { err: 'stock' };
  db.prepare('UPDATE keys SET used_by=?, used_at=CURRENT_TIMESTAMP WHERE id=?').run(uid, k.id);
  if (!isAdmin) db.prepare('UPDATE users SET credits=credits-? WHERE id=?').run(KEY_COST, uid);
  return { key: k.key };
});

function doClaim(chatId, mid, uid) {
  const r = claimKey(uid);
  if (r.err === 'credit') return screenConfirm(chatId, mid, uid);
  if (r.err === 'stock') {
    return show(chatId, mid, '😔 <b>Key ကုန်နေပါပြီ</b>\n\nAdmin ထပ်ဖြည့်မှ ပြန်ယူနိုင်ပါမယ်။\n(Credit မနှုတ်ပါ)', [backRow]);
  }
  return show(
    chatId, mid,
    `✅ <b>Key ရပါပြီ!</b>\n\n<code>${esc(r.key)}</code>\n\n👆 နှိပ်ပြီး Copy ကူးပါ\n💰 လက်ကျန်: <b>${creditText(uid, getUser(uid))}</b>`,
    [backRow]
  );
}

// ================= Admin Screens =================
const adminBack = [{ text: '🔙 Admin Panel', callback_data: 'adm_panel' }];
const cancelRow = [{ text: '❌ Cancel', callback_data: 'adm_panel' }];

function screenAdmin(chatId, mid, note = '') {
  adminState = null;
  return show(
    chatId, mid,
    `🛠 <b>Admin Panel</b>\n\n${note ? note + '\n\n' : ''}လုပ်ချင်တာကို ရွေးပါ 👇`,
    [
      [
        { text: '➕ Key တင်မယ်', callback_data: 'adm_addkey' },
        { text: '🗑 Key ဖျက်မယ်', callback_data: 'adm_keys:0' },
      ],
      [
        { text: '💰 Credit ထည့်မယ်', callback_data: 'adm_addcredit' },
        { text: '📣 အားလုံးကို စာပို့မယ်', callback_data: 'adm_broadcast' },
      ],
      [{ text: '📊 Stats', callback_data: 'adm_stats' }],
      backRow,
    ]
  );
}

function screenStats(chatId, mid) {
  const total = count('SELECT COUNT(*) c FROM users');
  const ver = count('SELECT COUNT(*) c FROM users WHERE verified=1');
  const cred = count('SELECT COALESCE(SUM(credits),0) c FROM users WHERE id<>?', ADMIN_ID);
  const avail = count('SELECT COUNT(*) c FROM keys WHERE used_by IS NULL');
  const used = count('SELECT COUNT(*) c FROM keys WHERE used_by IS NOT NULL');
  return show(
    chatId, mid,
    `📊 <b>Stats</b>\n\n👥 User စုစုပေါင်း: <b>${total}</b>\n✅ Join ပြီး: <b>${ver}</b>\n💰 User တွေ့ credit စုစုပေါင်း: <b>${cred}</b>\n\n🟢 Key လက်ကျန်: <b>${avail}</b>\n🔴 Key သုံးပြီး: <b>${used}</b>`,
    [adminBack]
  );
}

function screenKeys(chatId, mid, page) {
  const total = count('SELECT COUNT(*) c FROM keys');
  const pages = Math.max(1, Math.ceil(total / PAGE));
  page = Math.min(Math.max(page, 0), pages - 1);
  const rows = db
    .prepare('SELECT id, key, used_by FROM keys ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(PAGE, page * PAGE);
  const avail = count('SELECT COUNT(*) c FROM keys WHERE used_by IS NULL');

  const kb = rows.map((r) => [{
    text: `🗑 ${r.used_by ? '🔴' : '🟢'} #${r.id} ${keyLabel(r.key)}`,
    callback_data: `adm_del:${r.id}:${page}`,
  }]);
  const nav = [];
  if (page > 0) nav.push({ text: '⬅️', callback_data: `adm_keys:${page - 1}` });
  nav.push({ text: `${page + 1}/${pages}`, callback_data: 'adm_noop' });
  if (page < pages - 1) nav.push({ text: '➡️', callback_data: `adm_keys:${page + 1}` });
  kb.push(nav, adminBack);

  return show(
    chatId, mid,
    `🔑 <b>Keys</b>\n🟢 လက်ကျန် ${avail} · 🔴 သုံးပြီး ${total - avail}\n\n${total ? 'ဖျက်ချင်တဲ့ Key ကိုနှိပ်ပါ 👇' : 'Key မရှိသေးပါ'}`,
    kb
  );
}

function screenDelConfirm(chatId, mid, id, page) {
  const k = db.prepare('SELECT key, used_by FROM keys WHERE id=?').get(id);
  if (!k) return screenKeys(chatId, mid, page);
  return show(
    chatId, mid,
    `🗑 <b>ဒီ Key ကို ဖျက်မလား?</b>\n\n#${id} ${k.used_by ? '🔴 သုံးပြီး' : '🟢 လက်ကျန်'}\n<code>${esc(k.key)}</code>`,
    [[
      { text: '✅ ဖျက်မယ်', callback_data: `adm_delok:${id}:${page}` },
      { text: '❌ မဖျက်တော့ပါ', callback_data: `adm_keys:${page}` },
    ]]
  );
}

// ================= Admin က စာပို့လာရင် =================
async function handleAdminInput(msg) {
  const chatId = msg.chat.id;
  const st = adminState;
  const text = msg.text || '';

  // ---- Key တင် ----
  if (st.type === 'addkey') {
    const found = text.match(/vless:\/\/\S+/g) || [];
    if (!found.length) {
      return show(chatId, null, '❌ <b>vless:// key မတွေ့ပါ</b>\n\nပြန်ပို့ပါ (သို့) Cancel နှိပ်ပါ', [cancelRow]);
    }
    const ins = db.prepare('INSERT OR IGNORE INTO keys (key) VALUES (?)');
    let added = 0;
    for (const k of found) added += ins.run(k).changes;
    const dup = found.length - added;
    return screenAdmin(chatId, null, `✅ <b>${added}</b> key တင်ပြီးပါပြီ${dup ? `\n⚠️ ${dup} ခုက ထပ်နေလို့ ကျော်ထားတယ်` : ''}`);
  }

  // ---- Credit ထည့် ----
  if (st.type === 'addcredit') {
    const m = text.trim().match(/^(\d+|all)\s+(-?\d+)$/i);
    if (!m) {
      return show(
        chatId, null,
        '❌ <b>Format မှားနေပါတယ်</b>\n\n<code>USER_ID ပမာဏ</code>\nဥပမာ: <code>123456789 10</code>\nအားလုံးကို: <code>all 5</code>\n(နှုတ်ချင်ရင် -5 လို့ ရေးပါ)',
        [cancelRow]
      );
    }
    const amt = Number(m[2]);
    if (m[1].toLowerCase() === 'all') {
      const n = db.prepare('UPDATE users SET credits=MAX(credits+?,0) WHERE id<>?').run(amt, ADMIN_ID).changes;
      return screenAdmin(chatId, null, `✅ User <b>${n}</b> ယောက်လုံးကို <b>${amt > 0 ? '+' : ''}${amt}</b> credit ပြင်ပြီးပါပြီ`);
    }
    const id = Number(m[1]);
    const r = db.prepare('UPDATE users SET credits=MAX(credits+?,0) WHERE id=?').run(amt, id);
    if (!r.changes) {
      return show(chatId, null, `❌ User <code>${id}</code> မတွေ့ပါ\n\nID ပြန်စစ်ပြီး ပို့ပါ (သို့) Cancel နှိပ်ပါ`, [cancelRow]);
    }
    if (amt > 0) {
      bot.sendMessage(id, `🎁 Admin က <b>+${amt} credit</b> ထည့်ပေးလိုက်ပါတယ်!\n💰 လက်ကျန်: <b>${getUser(id).credits}</b>`, { parse_mode: 'HTML' }).catch(() => {});
    }
    return screenAdmin(chatId, null, `✅ <code>${id}</code> ကို <b>${amt > 0 ? '+' : ''}${amt}</b> credit ပြင်ပြီးပါပြီ\n💰 လက်ကျန်: <b>${getUser(id).credits}</b>`);
  }

  // ---- Broadcast (စာ/ပုံ/video ဘာပဲပို့ပို့ ရ) ----
  if (st.type === 'broadcast' || st.type === 'broadcast_confirm') {
    adminState = { type: 'broadcast_confirm', chat: chatId, mid: msg.message_id };
    const total = count('SELECT COUNT(*) c FROM users WHERE id<>?', ADMIN_ID);
    await bot.copyMessage(chatId, chatId, msg.message_id).catch(() => {});
    return show(
      chatId, null,
      `📣 အပေါ်က စာကို User <b>${total}</b> ယောက်ကို ပို့မလား?`,
      [[
        { text: '✅ ပို့မယ်', callback_data: 'adm_bc_go' },
        { text: '❌ မပို့တော့ပါ', callback_data: 'adm_panel' },
      ]]
    );
  }
}

async function runBroadcast(chatId, mid, st) {
  const ids = db.prepare('SELECT id FROM users WHERE id<>?').all(ADMIN_ID).map((r) => r.id);
  await show(chatId, mid, `📣 ပို့နေပါတယ်... (${ids.length} ယောက်)\nခဏစောင့်ပါ`, []);
  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      await bot.copyMessage(id, st.chat, st.mid);
      ok++;
    } catch (e) {
      fail++;
    }
    await sleep(50);
  }
  return show(
    chatId, mid,
    `✅ <b>ပို့ပြီးပါပြီ</b>\n\n✔️ အောင်မြင်: <b>${ok}</b>\n❌ မအောင်မြင် (Bot ကို Block ထား): <b>${fail}</b>`,
    [adminBack]
  );
}

// ================= Handlers =================
bot.on('message', async (msg) => {
  if (msg.chat.type !== 'private') return;
  const uid = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text || '';
  ensureUser(uid, text);

  const isCmd = text.startsWith('/');
  if (uid === ADMIN_ID && isCmd) adminState = null;
  if (uid === ADMIN_ID && adminState && !isCmd) return handleAdminInput(msg);

  if (!msg.text) return;

  if (uid !== ADMIN_ID) {
    const missing = await missingChats(uid);
    if (missing.length) return screenJoin(chatId, null, missing);
    onVerified(uid);
  }
  return screenMenu(chatId, null, uid);
});

bot.on('callback_query', async (q) => {
  if (!q.message) return;
  const uid = q.from.id;
  const chatId = q.message.chat.id;
  const mid = q.message.message_id;
  const data = q.data || '';
  ensureUser(uid);

  // Admin button တွေကို Admin ပဲနှိပ်လို့ရ
  if (data.startsWith('adm_') && uid !== ADMIN_ID) {
    return bot.answerCallbackQuery(q.id).catch(() => {});
  }

  if (uid !== ADMIN_ID) {
    const missing = await missingChats(uid);
    if (missing.length) {
      if (data === 'check_join') {
        return bot.answerCallbackQuery(q.id, { text: '❌ Join မထားသေးပါ', show_alert: true });
      }
      bot.answerCallbackQuery(q.id).catch(() => {});
      return screenJoin(chatId, mid, missing);
    }
    onVerified(uid);
  }

  bot.answerCallbackQuery(q.id).catch(() => {});
  const [action, a, b] = data.split(':');

  switch (action) {
    // ---- User ----
    case 'check_join':
    case 'menu':        return screenMenu(chatId, mid, uid);
    case 'credit':      return screenCredit(chatId, mid, uid);
    case 'invite':      return screenInvite(chatId, mid, uid);
    case 'getkey':      return screenConfirm(chatId, mid, uid);
    case 'confirm_key': return doClaim(chatId, mid, uid);

    // ---- Admin ----
    case 'adm_panel':   return screenAdmin(chatId, mid);
    case 'adm_stats':   return screenStats(chatId, mid);
    case 'adm_noop':    return;

    case 'adm_addkey':
      adminState = { type: 'addkey' };
      return show(chatId, mid, '➕ <b>Key တင်မယ်</b>\n\nvless:// Key တွေကို ပို့ပါ။\nတစ်ကြောင်းစီခွဲပြီး အများကြီး တစ်ခါတည်းပို့လို့ရပါတယ် 👇', [cancelRow]);

    case 'adm_keys':    return screenKeys(chatId, mid, Number(a) || 0);
    case 'adm_del':     return screenDelConfirm(chatId, mid, Number(a), Number(b) || 0);
    case 'adm_delok':
      db.prepare('DELETE FROM keys WHERE id=?').run(Number(a));
      return screenKeys(chatId, mid, Number(b) || 0);

    case 'adm_addcredit':
      adminState = { type: 'addcredit' };
      return show(
        chatId, mid,
        '💰 <b>Credit ထည့်မယ်</b>\n\n<code>USER_ID ပမာဏ</code> ပို့ပါ\nဥပမာ: <code>123456789 10</code>\n\nUser အားလုံးကို: <code>all 5</code>\n(နှုတ်ချင်ရင် -5 လို့ရေးပါ)\n\n💡 User ID ကို သူတို့ရဲ့ My Account မှာ မြင်ရပါတယ်',
        [cancelRow]
      );

    case 'adm_broadcast':
      adminState = { type: 'broadcast' };
      return show(chatId, mid, '📣 <b>အားလုံးကို စာပို့မယ်</b>\n\nပို့ချင်တဲ့ စာ/ပုံ/video ကို ဒီမှာပို့ပါ။\nပို့ခင် Preview ပြပြီး မေးပါမယ် 👇', [cancelRow]);

    case 'adm_bc_go': {
      const st = adminState;
      if (!st || st.type !== 'broadcast_confirm') return screenAdmin(chatId, mid);
      adminState = null;
      return runBroadcast(chatId, mid, st);
    }
  }
});

console.log('Bot started');
