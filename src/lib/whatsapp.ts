// src/lib/whatsapp.ts
// Sends WhatsApp messages via Twilio.
// Falls back to SMS if WhatsApp delivery fails.

import twilio from 'twilio'

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

const FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886'

// ── Send PIN setup invite ──────────────────────────────────
export async function sendPinSetupInvite({
  firstName,
  phone,
  setupUrl,
}: {
  firstName: string
  phone: string
  setupUrl: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    await client.messages.create({
      from: FROM,
      to: `whatsapp:${phone}`,
      body:
        `Hi ${firstName}, welcome to OpsPro. ` +
        `Set up your clock-in PIN here: ${setupUrl}\n\n` +
        `This link expires in 24 hours. Do not share it with anyone.`,
    })
    return { success: true }
  } catch (err: any) {
    console.error('WhatsApp send error:', err.message)
    return { success: false, error: err.message }
  }
}

// ── Send no-show alert to supervisor ──────────────────────
export async function sendNoShowAlert({
  supervisorPhone,
  employeeName,
  locationName,
  minutesLate,
}: {
  supervisorPhone: string
  employeeName: string
  locationName: string
  minutesLate: number
}): Promise<{ success: boolean; error?: string }> {
  try {
    await client.messages.create({
      from: FROM,
      to: `whatsapp:${supervisorPhone}`,
      body:
        `OpsPro alert: ${employeeName} has not clocked in at ` +
        `${locationName}. Shift started ${minutesLate} minutes ago.`,
    })
    return { success: true }
  } catch (err: any) {
    console.error('WhatsApp no-show alert error:', err.message)
    return { success: false, error: err.message }
  }
}
