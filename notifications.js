const nodemailer = require('nodemailer');

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

  console.log('[Notificaciones] Email configurado correctamente');
}

async function sendEmail(approval) {
  if (!transporter) return;
  const to = process.env.NOTIFICATION_EMAIL;
  if (!to) return;

  const optionLabel = `Opción ${approval.selected_option}`;
  const images = [approval.image1, approval.image2, approval.image3];
  const selectedImage = images[approval.selected_option - 1];

  try {
    await transporter.sendMail({
      from: `"Plataforma de Aprobaciones" <${process.env.SMTP_USER}>`,
      to,
      subject: `Aprobado: ${approval.title}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #1e293b; color: white; padding: 20px 24px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0; font-size: 18px;">Nueva Aprobación</h2>
          </div>
          <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
            <p style="color: #64748b; margin: 0 0 4px;">Título</p>
            <h3 style="color: #1e293b; margin: 0 0 16px; font-size: 20px;">${approval.title}</h3>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px;">
              <p style="margin: 0; color: #166534; font-weight: 600;">Selección: ${optionLabel}</p>
            </div>
            <p style="color: #64748b; font-size: 13px; margin: 0;">
              Aprobado el: ${approval.approved_at || new Date().toLocaleString('es-ES')}
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[Email] Notificación enviada para: ${approval.title}`);
  } catch (err) {
    console.error('[Email] Error al enviar:', err.message);
  }
}

async function sendTelegram(approval) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const optionLabel = `Opción ${approval.selected_option}`;
  const message = [
    `✅ *Nueva Aprobación*`,
    ``,
    `📋 *Título:* ${escapeMarkdown(approval.title)}`,
    `🎯 *Selección:* ${optionLabel}`,
    `📅 *Fecha:* ${approval.approved_at || new Date().toLocaleString('es-ES')}`,
  ].join('\n');

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }

    const images = [approval.image1, approval.image2, approval.image3];
    const selectedImage = images[approval.selected_option - 1];
    if (selectedImage) {
      const photoUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      await fetch(photoUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          photo: `${baseUrl}/uploads/${selectedImage}`,
          caption: `Imagen seleccionada - ${approval.title}`,
        }),
      });
    }

    console.log(`[Telegram] Notificación enviada para: ${approval.title}`);
  } catch (err) {
    console.error('[Telegram] Error al enviar:', err.message);
  }
}

function escapeMarkdown(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

async function notifyApproval(approval) {
  await Promise.all([sendEmail(approval), sendTelegram(approval)]);
}

module.exports = { initEmail, notifyApproval };
