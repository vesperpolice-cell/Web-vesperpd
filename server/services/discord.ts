/* Discord webhook integration — registration, medical and proctor embeds.
   Ported from legacy/express/services/discordWebhook.js, using fetch in place
   of the raw https module. */

import { config } from '@/server/config';
import { ApiError } from '@/server/errors';
import { findPendingPhone } from './pending';

interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface Embed {
  title?: string;
  description?: string;
  color?: number;
  fields: EmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

interface DiscordMessage {
  id?: string;
  content?: string;
  embeds?: Embed[];
}

interface RegistrationData {
  ocName: string;
  icName: string;
  ocAge: number;
  icPhone: string;
  discordId: string;
  steamUrl: string;
}

interface MedicalData {
  icName: string;
  ocAge: number;
  timeStart: string;
  timeEnd: string;
  medicalExperience: string;
  joinReason: string;
  discordId: string;
}

/* ---------- helpers ---------- */

function editUrl(webhookUrl: string, messageId: string): string {
  return `${webhookUrl.replace(/\/+$/, '')}/messages/${messageId}`;
}

function waitUrl(webhookUrl: string): string {
  return webhookUrl + (webhookUrl.includes('?') ? '&' : '?') + 'wait=true';
}

/** A numeric id becomes a real mention; anything else is shown verbatim. */
function toMention(discordId: string | undefined): string {
  if (!discordId) return 'ไม่ระบุ';
  return /^\d+$/.test(discordId) ? `<@${discordId}>` : discordId;
}

function truncate(text: string, max = 1000): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

async function discordRequest(
  url: string,
  method: 'GET' | 'POST' | 'PATCH',
  payload?: unknown
): Promise<DiscordMessage> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(config.REQUEST_TIMEOUT),
    });
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') {
      throw new ApiError('Discord API request timeout', 504);
    }
    throw new ApiError('เชื่อมต่อ Discord ไม่สำเร็จ', 502);
  }

  if (res.status === 404) {
    throw new ApiError('ไม่พบข้อความใน Discord (messageId ไม่ถูกต้องหรือถูกลบแล้ว)', 404);
  }
  if (res.status === 429) {
    throw new ApiError('Discord API rate limit กรุณารอสักครู่แล้วลองใหม่', 429);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(`Discord API error: ${res.status} - ${body.slice(0, 200)}`, 502);
  }

  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as DiscordMessage;
  } catch {
    return {};
  }
}

/** Refuses an edit unless the caller's Discord id appears in the message. */
async function verifyOwnership(webhookUrl: string, messageId: string, userId: string) {
  const message = await discordRequest(editUrl(webhookUrl, messageId), 'GET');
  const mention = `<@${userId}>`;

  const inContent = message.content?.includes(mention) ?? false;
  const inFields =
    message.embeds?.[0]?.fields?.some((f) => f.value?.includes(mention)) ?? false;

  if (!inContent && !inFields) {
    throw new ApiError('❌ ไม่ใช่ข้อมูลของคุณ — Message ID นี้เป็นของคนอื่น', 403);
  }
}

function requireWebhook(url: string, label: string): string {
  if (!url) throw new ApiError(`ระบบยังไม่ได้ตั้งค่า Webhook สำหรับ${label}`, 500);
  return url;
}

function footerFor(editCount: number, department: string): string {
  return editCount > 0
    ? `✏️ แก้ไขแล้ว ${editCount} ครั้ง • ${department}`
    : `${department} • ระบบสมัครอัตโนมัติ`;
}

/* ---------- embeds ---------- */

function registrationEmbed(data: RegistrationData, editCount = 0) {
  const mention = toMention(data.discordId);

  const embed: Embed = {
    title: '🚔 ใบสมัครตำรวจใหม่',
    description: 'มีผู้สมัครเข้าร่วมกรมตำรวจ VES-PD',
    color: 0xdc6d0b,
    fields: [
      { name: '👤 ชื่อ เล่น IC', value: data.ocName || 'ไม่ระบุ', inline: true },
      { name: '📝 ชื่อ IC / ชื่อตามบัตรประชาชน', value: data.icName || 'ไม่ระบุ', inline: true },
      { name: '🎂 อายุ OC', value: data.ocAge ? `${data.ocAge} ปี` : 'ไม่ระบุ', inline: true },
      /* The phone is deliberately absent: it still goes to the sheet, but this
         embed sits in a channel anyone can scroll back through. fetchRegistration
         reads it back from the sheet so editing keeps working. */
      { name: '💬 Discord', value: mention, inline: true },
      { name: '🎮 Steam', value: data.steamUrl || 'ไม่ระบุ', inline: true },
    ],
    footer: { text: footerFor(editCount, 'VES-PD Police Department') },
    timestamp: new Date().toISOString(),
  };

  return { embed, content: mention !== 'ไม่ระบุ' ? mention : undefined };
}

function medicalEmbed(data: MedicalData, editCount = 0) {
  const mention = toMention(data.discordId);
  const timeRange =
    !data.timeStart && !data.timeEnd
      ? 'ไม่ระบุ'
      : `${data.timeStart || '—'} - ${data.timeEnd || '—'}`;

  const embed: Embed = {
    title: '❤️‍🩹 ใบสมัครแพทย์ใหม่',
    description: 'ผู้สมัครเข้าร่วมหน่วยแพทย์ VES-PD',
    color: 0xef4444,
    fields: [
      { name: '📛 ชื่อ - นามสกุล (IC/ตามบัตร)', value: data.icName || 'ไม่ระบุ', inline: false },
      { name: '🎂 อายุ (OC)', value: data.ocAge ? `${data.ocAge} ปี` : 'ไม่ระบุ', inline: true },
      { name: '💬 Discord', value: mention, inline: true },
      { name: '⏰ เวลาที่สามารถปฏิบัติหน้าที่ได้', value: timeRange, inline: false },
      { name: '💊 ประสบการณ์ด้านสายแพทย์', value: truncate(data.medicalExperience), inline: false },
      { name: '💡 เหตุผลที่ต้องการเข้าร่วม', value: truncate(data.joinReason), inline: false },
    ],
    footer: { text: footerFor(editCount, 'VES-PD Medical Department') },
    timestamp: new Date().toISOString(),
  };

  return { embed, content: mention !== 'ไม่ระบุ' ? mention : undefined };
}

/* ---------- field extraction ---------- */

function fieldReader(fields: EmbedField[], stripMentions = false) {
  return (name: string): string => {
    const field = fields.find((f) => f.name.includes(name));
    if (!field) return '';
    let value = field.value.replace(/\*\*/g, '').trim();
    if (stripMentions) value = value.replace(/<@\d+>/g, '').trim();
    return value;
  };
}

function readEditCount(embed: Embed): number {
  const match = embed.footer?.text.match(/แก้ไขแล้ว (\d+) ครั้ง/);
  return match ? parseInt(match[1], 10) : 0;
}

async function loadEmbed(webhookUrl: string, messageId: string): Promise<Embed> {
  const response = await discordRequest(editUrl(webhookUrl, messageId), 'GET');
  const embed = response.embeds?.[0];
  if (!embed) {
    throw new ApiError('ไม่พบ embed ในข้อความนี้ — Message ID อาจไม่ถูกต้อง', 404);
  }
  return embed;
}

/* ---------- police registration ---------- */

export async function sendRegistration(data: RegistrationData): Promise<string> {
  const url = requireWebhook(config.DISCORD_REGISTER_WEBHOOK_URL, 'การสมัคร');
  const { embed, content } = registrationEmbed(data);

  const response = await discordRequest(waitUrl(url), 'POST', { content, embeds: [embed] });
  if (!response.id) {
    throw new ApiError('Discord ไม่ได้คืน message ID — อาจเป็นปัญหา Discord API', 502);
  }
  return response.id;
}

export async function editRegistration(
  messageId: string,
  data: RegistrationData,
  editCount: number,
  verifiedUserId: string
): Promise<void> {
  const url = requireWebhook(config.DISCORD_REGISTER_WEBHOOK_URL, 'การสมัคร');
  await verifyOwnership(url, messageId, verifiedUserId);

  const { embed, content } = registrationEmbed(data, editCount);
  await discordRequest(editUrl(url, messageId), 'PATCH', { content, embeds: [embed] });
}

export async function fetchRegistration(messageId: string, verifiedUserId: string) {
  const url = requireWebhook(config.DISCORD_REGISTER_WEBHOOK_URL, 'การสมัคร');
  const embed = await loadEmbed(url, messageId);
  await verifyOwnership(url, messageId, verifiedUserId);

  const read = fieldReader(embed.fields || []);

  return {
    data: {
      ocName: read('ชื่อ เล่น IC'),
      icName: read('ชื่อ IC'),
      ocAge: parseInt(read('อายุ OC'), 10) || 0,
      /* From the sheet, not the embed — see findPendingPhone. Older embeds
         still carry the field, but reading it there would mean the number
         goes on being republished every time the application is edited. */
      icPhone: await findPendingPhone(verifiedUserId),
      discordId: read('Discord'),
      steamUrl: read('Steam'),
    },
    editCount: readEditCount(embed),
    messageId,
  };
}

/* ---------- medical registration ---------- */

export async function sendMedical(data: MedicalData): Promise<string> {
  const url = requireWebhook(config.DISCORD_MEDICAL_WEBHOOK_URL, 'การสมัครแพทย์');
  const { embed, content } = medicalEmbed(data);

  const response = await discordRequest(waitUrl(url), 'POST', { content, embeds: [embed] });
  if (!response.id) {
    throw new ApiError('Discord ไม่ได้คืน message ID — อาจเป็นปัญหา Discord API', 502);
  }
  return response.id;
}

export async function editMedical(
  messageId: string,
  data: MedicalData,
  editCount: number,
  verifiedUserId: string
): Promise<void> {
  const url = requireWebhook(config.DISCORD_MEDICAL_WEBHOOK_URL, 'การสมัครแพทย์');
  await verifyOwnership(url, messageId, verifiedUserId);

  const { embed, content } = medicalEmbed(data, editCount);
  await discordRequest(editUrl(url, messageId), 'PATCH', { content, embeds: [embed] });
}

export async function fetchMedical(messageId: string, verifiedUserId: string) {
  const url = requireWebhook(config.DISCORD_MEDICAL_WEBHOOK_URL, 'การสมัครแพทย์');
  const embed = await loadEmbed(url, messageId);
  await verifyOwnership(url, messageId, verifiedUserId);

  const fields = embed.fields || [];
  const read = fieldReader(fields, true);

  const timeField = fields.find((f) => f.name.includes('เวลาที่สามารถปฏิบัติหน้าที่ได้'));
  const timeMatch = timeField?.value
    .replace(/\*\*/g, '')
    .trim()
    .match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);

  return {
    data: {
      icName: read('ชื่อ - นามสกุล'),
      ocAge: parseInt(read('อายุ'), 10) || 0,
      timeStart: timeMatch?.[1] ?? '',
      timeEnd: timeMatch?.[2] ?? '',
      medicalExperience: read('ประสบการณ์ด้านสายแพทย์'),
      joinReason: read('เหตุผลที่ต้องการเข้าร่วม'),
      discordId: read('Discord'),
    },
    editCount: readEditCount(embed),
    messageId,
  };
}

/* ---------- proctor ---------- */

export async function sendProctorRecord(
  proctor: { id: string },
  applicant: { icName: string; discordId?: string }
): Promise<void> {
  const url = config.DISCORD_PROCTOR_WEBHOOK_URL;
  if (!url) return; // Optional integration — silently skipped when unset.

  const thaiDate = new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const embed: Embed = {
    title: '📋 บันทึกการคุมสอบ Proctor',
    color: 0xdc6d0b,
    fields: [
      { name: '👮 ผู้คุมสอบ', value: `<@${proctor.id}>`, inline: false },
      { name: '👤 ผู้สอบ', value: applicant.icName || 'ไม่ระบุ', inline: true },
      { name: '📅 วันที่สอบ', value: new Date().toISOString().split('T')[0], inline: true },
      {
        name: '🆔 Discord ID ผู้สอบ',
        value: applicant.discordId ? `<@${applicant.discordId}>` : 'ไม่ระบุ',
        inline: false,
      },
    ],
    footer: { text: `VES-PD Police Department - Proctor System • ${thaiDate}` },
    timestamp: new Date().toISOString(),
  };

  await discordRequest(waitUrl(url), 'POST', {
    content: `<@${proctor.id}>`,
    embeds: [embed],
  });
}
