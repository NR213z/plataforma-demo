const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

let transporter = null;

function initEmail() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log('[Notificaciones] Email no configurado - se omitirán notificaciones por correo');
    return;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587'),
    secure: parseInt(SMTP_PORT || '587') === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  console.log('[Notificaciones] Email configurado');
}

function escapeMarkdown(text = '') {
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

async function sendTelegramMsg(text, extra = {}) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  // Soporta múltiples destinatarios separados por coma: "123456,789012,..."
  const chatIds = TELEGRAM_CHAT_ID.split(',').map(id => id.trim()).filter(Boolean);

  await Promise.allSettled(chatIds.map(async chatId => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (err) {
      console.error(`[Telegram] Error enviando a ${chatId}:`, err.message);
    }
  }));
}

async function notifyApproval(approval) {
  const categoryLabel = approval.category || 'Web';
  const isDiario = categoryLabel === 'Diario';
  const optionWord = isDiario ? 'Página' : 'Opción';
  const approver = approval.approved_by_username || 'Usuario';

  // Telegram
  const tgMsg = [
    `✅ *Nueva Aprobación*`,
    ``,
    `📋 *Título:* ${escapeMarkdown(approval.title)}`,
    `🏷️ *Categoría:* ${categoryLabel}`,
    `👤 *Aprobado por:* ${escapeMarkdown(approver)}`,
    `🎯 *Selección:* ${optionWord} ${approval.selected_option}`,
    `📅 *Fecha:* ${approval.approved_at || new Date().toLocaleString('es-ES')}`,
  ].join('\n');
  await sendTelegramMsg(tgMsg);

  // Enviar la imagen aprobada como archivo (solo Web y Gráfica, Diario no)
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && approval.selected_option && !isDiario) {
    const images = [approval.image1, approval.image2, approval.image3].filter(Boolean);
    const img = images[approval.selected_option - 1];
    const filePath = img ? path.join(__dirname, 'uploads', img) : null;

    if (filePath && fs.existsSync(filePath)) {
      const chatIds = TELEGRAM_CHAT_ID.split(',').map(id => id.trim()).filter(Boolean);
      const fileBuffer = fs.readFileSync(filePath);
      const blob = new Blob([fileBuffer], { type: 'image/png' });
      const caption = `${optionWord} seleccionada — ${approval.title}`;

      await Promise.allSettled(chatIds.map(async chatId => {
        try {
          const fd = new FormData();
          fd.append('chat_id', chatId);
          fd.append('photo', blob, img);
          fd.append('caption', caption);
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
            method: 'POST',
            body: fd,
          });
        } catch (e) { /* ignore photo errors */ }
      }));
    }
  }

  // Email
  if (transporter && process.env.NOTIFICATION_EMAIL) {
    try {
      await transporter.sendMail({
        from: `"Aprobaciones" <${process.env.SMTP_USER}>`,
        to: process.env.NOTIFICATION_EMAIL,
        subject: `Aprobado: ${approval.title}`,
        html: `<p><b>${approval.title}</b> fue aprobado (${optionWord} ${approval.selected_option}) por <b>${approver}</b>.</p>`,
      });
    } catch (err) {
      console.error('[Email] Error:', err.message);
    }
  }
}

async function notifyComment(approval, commentText, authorUsername) {
  const preview = commentText ? commentText.slice(0, 200) : '(imagen adjunta)';
  const tgMsg = [
    `💬 *Nuevo comentario*`,
    ``,
    `📋 *Solicitud:* ${escapeMarkdown(approval.title)}`,
    `🏷️ *Categoría:* ${approval.category || 'Web'}`,
    `👤 *Por:* ${escapeMarkdown(authorUsername || 'Usuario')}`,
    ``,
    `_"${escapeMarkdown(preview)}"_`,
  ].join('\n');
  await sendTelegramMsg(tgMsg);
}

async function notifyReopen(approval, reopenedByUsername) {
  const tgMsg = [
    `🔄 *Solicitud re-abierta para aprobación*`,
    ``,
    `📋 *Título:* ${escapeMarkdown(approval.title)}`,
    `🏷️ *Categoría:* ${approval.category || 'Web'}`,
    `👤 *Re-abierta por:* ${escapeMarkdown(reopenedByUsername || 'Usuario')}`,
  ].join('\n');
  await sendTelegramMsg(tgMsg);
}

module.exports = { initEmail, notifyApproval, notifyComment, notifyReopen };
