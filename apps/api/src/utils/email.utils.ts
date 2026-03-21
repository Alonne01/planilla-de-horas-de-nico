import nodemailer from 'nodemailer';

// ─── SMTP Configuration ─────────────────────────
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM ?? 'noreply@planillahoras.com';

const isSmtpConfigured = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

// Create transporter only if SMTP is configured
const transporter = isSmtpConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    })
  : null;

// ─── Send Password Reset Email ──────────────────

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const subject = 'Recuperar contraseña — Planilla de Horas';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0;padding:0;background-color:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="max-width:480px;margin:40px auto;padding:0 20px;">
        <!-- Header -->
        <div style="text-align:center;padding:32px 0 24px;">
          <div style="display:inline-block;width:48px;height:48px;background:rgba(99,102,241,0.15);border-radius:12px;line-height:48px;font-size:24px;">
            🔑
          </div>
          <h1 style="color:#fafafa;font-size:22px;font-weight:700;margin:16px 0 0;">
            Recuperar Contraseña
          </h1>
        </div>

        <!-- Card -->
        <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:32px 24px;">
          <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 20px;">
            Recibimos una solicitud para restablecer tu contraseña.
            Hacé click en el botón para crear una nueva contraseña:
          </p>

          <div style="text-align:center;margin:28px 0;">
            <a href="${resetUrl}"
               style="display:inline-block;background:#6366f1;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px;">
              Restablecer Contraseña
            </a>
          </div>

          <p style="color:#71717a;font-size:12px;line-height:1.5;margin:20px 0 0;">
            Este link expira en <strong style="color:#a1a1aa;">1 hora</strong>.
            Si no solicitaste este cambio, ignorá este email.
          </p>

          <!-- Fallback URL -->
          <div style="margin-top:20px;padding:12px;background:#0a0a0b;border-radius:8px;word-break:break-all;">
            <p style="color:#52525b;font-size:11px;margin:0 0 4px;">Si el botón no funciona, copiá este link:</p>
            <p style="color:#6366f1;font-size:11px;margin:0;">${resetUrl}</p>
          </div>
        </div>

        <!-- Footer -->
        <p style="text-align:center;color:#3f3f46;font-size:11px;margin-top:24px;">
          Planilla de Horas — Gestión de jornadas laborales
        </p>
      </div>
    </body>
    </html>
  `;

  if (!transporter) {
    // Dev mode: log to console
    console.log('\n══════════════════════════════════════════════════');
    console.log('📧 PASSWORD RESET EMAIL (dev mode — SMTP not configured)');
    console.log('══════════════════════════════════════════════════');
    console.log(`  To:    ${to}`);
    console.log(`  Link:  ${resetUrl}`);
    console.log('══════════════════════════════════════════════════\n');
    return;
  }

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    html,
  });
}
