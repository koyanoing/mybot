require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Database = require('better-sqlite3');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const db = new Database('bot.db');

const ADMIN_ID = 8690698115;
const REWARD = 5;    // ဖိတ်ခေါ်တစ်ယောက် = credit
const KEY_COST = 5;  // key တစ်ခု = credit
const REQUIRED = [
  { id: '@arsar2027', link: 'https://t.me/arsar2027', name: 'Group' },
];
const GROUP_LINK = 'https://t.me/arsar2027';

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

// ================= Helpers =================
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const getUser = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);

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

// ================= Screens =================
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
  const stock = db.prepare('SELECT COUNT(*) c FROM keys WHERE used_by IS NULL').get().c;
  return show(
    chatId, mid,
    `✨ <b>ကြိုဆိုပါတယ်!</b>\n\n💰 Credit: <b>${u.credits}</b>\n🔑 Key လက်ကျန်: <b>${stock}</b>\n\nအောက်က ခလုတ်တွေကို နှိပ်ပါ 👇`,
    [
      [{ text: '🔑 Free VLESS Key ယူမယ်', callback_data: 'getkey' }],
      [
        { text: '💰 My Account', callback_data: 'credit' },
        { text: '👥 ဖိတ်ခေါ်မယ်', callback_data: 'invite' },
      ],
      [{ text: '📢 Group', url: GROUP_LINK }],
    ]
  );
}

function screenCredit(chatId, mid, uid) {
  const u = getUser(uid);
  const invited = db.prepare('SELECT COUNT(*) c FROM users WHERE referred_by=? AND verified=1').get(uid).c;
  const got = db.prepare('SELECT COUNT(*) c FROM keys WHERE used_by=?').get(uid).c;
  return show(
    chatId, mid,
    `👤 <b>My Account</b>\n\n🆔 ID: <code>${uid}</code>\n💰 Credit: <b>${u.credits}</b>\n👥 ဖိတ်ခေါ်ပြီးသူ: <b>${invited}</b>\n🔑 ယူပြီး Key: <b>${got}</b>\n\n🎁 ${KEY_COST} credit = Key ၁ ခု`,
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
  if (u.credits < KEY_COST) {
    return show(
      chatId, mid,
      `❌ <b>Credit မလောက်ပါ</b>\n\nလိုအပ်: <b>${KEY_COST}</b>\nရှိတာ: <b>${u.credits}</b>\n\nသူငယ်ချင်းခေါ်ပြီး Credit ရယူပါ 👇`,
      [[{ text: '👥 ဖိတ်ခေါ်မယ်', callback_data: 'invite' }], backRow]
    );
  }
  return show(
    chatId, mid,
    `🔑 <b>${KEY_COST} credit</b> သုံးပြီး Key တစ်ခု ယူမလား?`,
    [[
      { text: '✅ ယူမယ်', callback_data: 'confirm_key' },
      { text: '❌ မယူတော့ပါ', callback_data: 'menu' },
    ]]
  );
}

// Key ယူခြင်း (credit နှုတ် + key ချထား တစ်ပြိုင်တည်း)
const claimKey = db.transaction((uid) => {
  const u = getUser(uid);
  if (u.credits < KEY_COST) return { err: 'credit' };
  const k = db.prepare('SELECT id, key FROM keys WHERE used_by IS NULL ORDER BY id LIMIT 1').get();
  if (!k) return { err: 'stock' };
  db.prepare('UPDATE keys SET used_by=?, used_at=CURRENT_TIMESTAMP WHERE id=?').run(uid, k.id);
  db.prepare('UPDATE users SET credits=credits-? WHERE id=?').run(KEY_COST, uid);
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
    `✅ <b>Key ရပါပြီ!</b>\n\n<code>${esc(r.key)}</code>\n\n👆 နှိပ်ပြီး Copy ကူးပါ\n💰 လက်ကျန်: <b>${getUser(uid).credits}</b>`,
    [backRow]
  );
}

// ================= Admin commands =================
async function adminCommand(msg) {
  const chatId = msg.chat.id;
  const text = msg.text;
  const cmd = text.split(/\s+/)[0].split('@')[0];

  if (cmd === '/admin') {
    await bot.sendMessage(
      chatId,
      '🛠 <b>Admin Commands</b>\n\n/addkey <code>vless://...</code> — Key တင် (လိုင်းခွဲပြီး အများကြီးတင်လို့ရ)\n/delkey <code>ID</code> — Key ဖျက် (ID အများကြီးခြား၍ရ)\n/keys — Key စာရင်းကြည့်',
      { parse_mode: 'HTML' }
    );
    return true;
  }

  if (cmd === '/addkey') {
    const found = text.match(/vless:\/\/\S+/g) || [];
    if (!found.length) {
      await bot.sendMessage(chatId, '❌ vless:// key မတွေ့ပါ\n\nဥပမာ: /addkey vless://...');
      return true;
    }
    const ins = db.prepare('INSERT OR IGNORE INTO keys (key) VALUES (?)');
    let added = 0;
    for (const k of found) added += ins.run(k).changes;
    await bot.sendMessage(chatId, `✅ ${added} key တင်ပြီး${found.length - added ? `\n⚠️ ${found.length - added} ခုက ထပ်နေလို့ ကျော်ထား` : ''}`);
    return true;
  }

  if (cmd === '/delkey') {
    const ids = (text.match(/\d+/g) || []).map(Number);
    if (!ids.length) {
      await bot.sendMessage(chatId, '❌ ID ထည့်ပါ\n\nဥပမာ: /delkey 5');
      return true;
    }
    const del = db.prepare('DELETE FROM keys WHERE id=?');
    let n = 0;
    for (const id of ids) n += del.run(id).changes;
    await bot.sendMessage(chatId, `🗑 ${n} key ဖျက်ပြီး`);
    return true;
  }

  if (cmd === '/keys') {
    const c = (w) => db.prepare(`SELECT COUNT(*) c FROM keys ${w}`).get().c;
    const rows = db.prepare('SELECT id, key, used_by FROM keys ORDER BY id DESC LIMIT 20').all();
    const list = rows
      .map((r) => `${r.used_by ? '🔴' : '🟢'} <b>#${r.id}</b> <code>${esc(r.key.slice(0, 35))}…</code>`)
      .join('\n');
    await bot.sendMessage(
      chatId,
      `🔑 <b>Keys</b>\n\nစုစုပေါင်း: ${c('')}\n🟢 လက်ကျန်: ${c('WHERE used_by IS NULL')}\n🔴 သုံးပြီး: ${c('WHERE used_by IS NOT NULL')}\n\n${list || 'မရှိသေးပါ'}`,
      { parse_mode: 'HTML' }
    );
    return true;
  }
  return false;
}

// ================= Handlers =================
bot.on('message', async (msg) => {
  if (msg.chat.type !== 'private' || !msg.text) return;
  const uid = msg.from.id;
  const chatId = msg.chat.id;
  ensureUser(uid, msg.text);

  if (uid === ADMIN_ID && (await adminCommand(msg))) return;

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
  ensureUser(uid);

  if (uid !== ADMIN_ID) {
    const missing = await missingChats(uid);
    if (missing.length) {
      if (q.data === 'check_join') {
        return bot.answerCallbackQuery(q.id, { text: '❌ Join မထားသေးပါ', show_alert: true });
      }
      bot.answerCallbackQuery(q.id).catch(() => {});
      return screenJoin(chatId, mid, missing);
    }
    onVerified(uid);
  }

  bot.answerCallbackQuery(q.id).catch(() => {});
  switch (q.data) {
    case 'check_join':
    case 'menu':        return screenMenu(chatId, mid, uid);
    case 'credit':      return screenCredit(chatId, mid, uid);
    case 'invite':      return screenInvite(chatId, mid, uid);
    case 'getkey':      return screenConfirm(chatId, mid, uid);
    case 'confirm_key': return doClaim(chatId, mid, uid);
  }
});
