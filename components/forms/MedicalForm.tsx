'use client';

/* Port of v2's public/medical.html + src/styles/pages/medical.css — same
   copy, colours, fields and flow, expressed with this app's shared form
   pieces instead of hand-wired DOM. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { mutations } from '@/lib/client/queries';
import { useDiscordAuth } from '@/lib/client/useDiscordAuth';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { BackHome } from '@/components/ui/BackHome';
import {
  DiscordConnectPanel,
  DiscordIdField,
  EditSection,
  type EditLookup,
  EditToggle,
  ErrorBox,
  Field,
  FormInput,
  FormTextArea,
  RequiredDiscordNote,
  SubmitBar,
  applicationPageClasses,
} from './ApplicationForm';

const c = applicationPageClasses;

/** v2's .time-input-wrapper input[type="time"] — wider type, own picker tint. */
const TIME_INPUT =
  'w-full cursor-pointer rounded-md border border-accent/12 bg-white/5 px-4 py-3.5 font-eng text-base text-ink outline-none transition hover:border-accent/30 focus:border-accent focus:bg-accent/10 focus:shadow-[0_0_0_3px_rgba(220,109,11,0.1)] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:[filter:invert(0.7)]';

interface FormState {
  icFirstName: string;
  icLastName: string;
  ocAge: string;
  timeStart: string;
  timeEnd: string;
  medicalExperience: string;
  joinReason: string;
}

const EMPTY: FormState = {
  icFirstName: '',
  icLastName: '',
  ocAge: '',
  timeStart: '',
  timeEnd: '',
  medicalExperience: '',
  joinReason: '',
};

interface Notice {
  messages: string[];
  tone: 'error' | 'success';
}

/** What v2 kept in localStorage so "แก้ไขข้อมูลนี้" can refill the form. */
interface SavedSubmission {
  messageId: string;
  editCount: number;
  data: FormState;
}

function storageKey(userId: string): string {
  return `medical_registration_${userId}`;
}

function loadSaved(userId: string | undefined): SavedSubmission | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as SavedSubmission) : null;
  } catch {
    return null;
  }
}

function save(userId: string | undefined, entry: SavedSubmission) {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(entry));
  } catch {
    /* private mode or full quota — the Message ID on screen is the real copy */
  }
}

/** The API joins its validation messages; v2 listed them one per line. */
function toLines(message: string): string[] {
  return message.split(' • ').filter(Boolean);
}

/** v2's #loadingOverlay. */
function LoadingOverlay({ text }: { text: string }) {
  return (
    <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-5 bg-[rgba(10,10,10,0.9)] backdrop-blur-[5px]">
      <div className="h-[50px] w-[50px] animate-[spin_1s_linear_infinite] rounded-full border-[3px] border-accent/12 border-t-accent" />
      <p className="text-base text-ink-dim">{text}</p>
    </div>
  );
}

export function MedicalForm() {
  const auth = useDiscordAuth('medical');

  const [form, setForm] = useState<FormState>(EMPTY);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingText, setLoadingText] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ title: string; messageId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [lookup, setLookup] = useState<EditLookup | null>(null);
  const [messageId, setMessageId] = useState('');
  const [editCount, setEditCount] = useState(0);

  /** Which account has already been looked up, so connecting does it once. */
  const checkedFor = useRef<string | null>(null);

  const set =
    (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  function showErrors(messages: string[]) {
    setNotice({ messages, tone: 'error' });
  }

  /** v2 refused a name typed with a space in either half. */
  function nameErrors(): string[] {
    const found: string[] = [];
    if (/\s/.test(form.icFirstName.trim())) found.push('First Name ห้ามมีเว้นวรรค');
    if (/\s/.test(form.icLastName.trim())) found.push('Last Name ห้ามมีเว้นวรรค');
    return found;
  }

  function fillFrom(data: FormState) {
    setForm(data);
  }

  function exitEditMode() {
    setEditMode(false);
    setLookup(null);
    setMessageId('');
    setEditCount(0);
  }

  /** Drops a submission read back out of Discord into the form. */
  const applyLoaded = useCallback(
    (result: {
      data: {
        icName: string;
        ocAge: number;
        timeStart: string;
        timeEnd: string;
        medicalExperience: string;
        joinReason: string;
      };
      editCount: number;
      messageId: string;
    }) => {
      const [first = '', ...rest] = (result.data.icName || '').split(' ');

      setForm({
        icFirstName: first,
        icLastName: rest.join(' '),
        ocAge: result.data.ocAge ? String(result.data.ocAge) : '',
        timeStart: result.data.timeStart,
        timeEnd: result.data.timeEnd,
        medicalExperience: result.data.medicalExperience,
        joinReason: result.data.joinReason,
      });
      setEditCount(result.editCount);
      setMessageId(result.messageId);
    },
    []
  );

  /**
   * Connecting Discord finds an earlier application on its own, the same way
   * the police form does. Finding nothing is silent — that is simply a first
   * application, not an error.
   */
  useEffect(() => {
    const userId = auth.user?.userId;
    if (!userId || checkedFor.current === userId) return;
    checkedFor.current = userId;

    let alive = true;

    mutations
      .myMedical()
      .then((result) => {
        if (!alive) return;
        applyLoaded(result);
        setEditMode(true);
        setLookup({ status: 'found', message: '' });
      })
      .catch(() => {
        /* Nothing to edit; this is a new application. */
      });

    return () => {
      alive = false;
    };
  }, [auth.user?.userId, applyLoaded]);

  /** The edit button, for an application the lookup could not find. */
  async function startEdit() {
    setEditMode(true);
    setNotice(null);
    setLookup({ status: 'loading', message: '' });

    try {
      applyLoaded(await mutations.myMedical());
      setLookup({ status: 'found', message: '' });
    } catch (err) {
      setLookup({ status: 'missing', message: (err as Error).message });
    }
  }

  /** Pulls an existing submission back out of its Discord embed. */
  async function loadExisting() {
    const id = messageId.trim();

    if (!id) {
      showErrors(['กรุณากรอก Message ID ก่อนกดดึงข้อมูล']);
      return;
    }
    if (!/^\d+$/.test(id)) {
      showErrors(['Message ID ไม่ถูกต้อง — ควรเป็นตัวเลขเท่านั้น']);
      return;
    }
    if (!auth.user) {
      showErrors(['กรุณาเชื่อมต่อ Discord หรือกรอก Discord ID ก่อน']);
      return;
    }

    setLoadingText('กำลังโหลดข้อมูล...');

    try {
      const result = await mutations.fetchMedical(id, auth.user.userId);
      const [first = '', ...rest] = (result.data.icName || '').split(' ');

      fillFrom({
        icFirstName: first,
        icLastName: rest.join(' '),
        ocAge: result.data.ocAge ? String(result.data.ocAge) : '',
        timeStart: result.data.timeStart,
        timeEnd: result.data.timeEnd,
        medicalExperience: result.data.medicalExperience,
        joinReason: result.data.joinReason,
      });
      setEditCount(result.editCount);
      setNotice({
        messages: ['✅ ดึงข้อมูลสำเร็จ — แก้ไขแล้วกด "บันทึกการแก้ไข"'],
        tone: 'success',
      });
    } catch (err) {
      showErrors(toLines((err as Error).message));
    } finally {
      setLoadingText(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (!auth.user) {
      showErrors(['กรุณาเชื่อมต่อ Discord ก่อนสมัคร']);
      return;
    }

    const names = nameErrors();
    if (names.length) {
      showErrors(names);
      return;
    }

    setNotice(null);

    const payload = {
      icName: `${form.icFirstName.trim()} ${form.icLastName.trim()}`.trim(),
      ocAge: Number(form.ocAge),
      timeStart: form.timeStart,
      timeEnd: form.timeEnd,
      medicalExperience: form.medicalExperience.trim(),
      joinReason: form.joinReason.trim(),
      discordId: auth.user.userId,
      discordUserId: auth.user.userId,
      discordDisplayName: auth.user.name,
    };

    if (editMode) {
      const id = messageId.trim();

      if (!id) {
        showErrors(['กรุณากรอก Message ID ที่คัดลอกจาก Discord']);
        return;
      }
      if (!/^\d+$/.test(id)) {
        showErrors(['Message ID ไม่ถูกต้อง — ควรเป็นตัวเลขเท่านั้น']);
        return;
      }

      setLoadingText('กำลังแก้ไขข้อมูล...');

      try {
        const result = await mutations.editMedical({ ...payload, messageId: id, editCount });
        save(auth.user.userId, { messageId: id, editCount: result.editCount, data: form });
        setSubmitted({ title: 'แก้ไขข้อมูลแล้ว!', messageId: id });
      } catch (err) {
        showErrors(toLines((err as Error).message));
      } finally {
        setLoadingText(null);
      }

      return;
    }

    setLoadingText('กำลังส่งข้อมูล...');

    try {
      const result = await mutations.medical(payload);
      save(auth.user.userId, { messageId: result.messageId, editCount: 0, data: form });
      setSubmitted({ title: 'สมัครสำเร็จ!', messageId: result.messageId });
    } catch (err) {
      showErrors(toLines((err as Error).message));
    } finally {
      setLoadingText(null);
    }
  }

  async function copyMessageId() {
    if (!submitted) return;
    try {
      await navigator.clipboard.writeText(submitted.messageId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the ID stays selectable in the field */
    }
  }

  /** v2's resetForm(): a blank form that asks for Discord again. */
  function resetForm() {
    setForm(EMPTY);
    setNotice(null);
    setSubmitted(null);
    exitEditMode();
    auth.disconnect();
  }

  /** v2's "แก้ไขข้อมูลนี้": reopen the form on the submission just sent. */
  function editSubmitted() {
    const saved = loadSaved(auth.user?.userId);

    setSubmitted(null);
    setEditMode(true);

    if (saved) {
      fillFrom(saved.data);
      setMessageId(saved.messageId);
      setEditCount(saved.editCount);
      setLookup({ status: 'found', message: '' });
    }
  }

  return (
    <div className={c.page}>
      <SiteHeader
        title="Vesper Medical Department"
        unit="หน่วยแพทย์"
        badge="💚 MEDICAL"
      />

      <main className={c.main}>
        <div className="w-full max-w-[650px]">
          <BackHome className="mb-3" />
          {submitted ? (
            <div className={c.successCard}>
              <div className={c.successIcon}>✔</div>
              <h2 className={c.successTitle}>{submitted.title}</h2>
              <p className={c.successText}>ข้อมูลการสมัครของคุณถูกส่งไปยังทีมงานเรียบร้อยแล้ว</p>
              <p className={c.successNote}>ทีมงานจะติดต่อกลับผ่าน Discord ของคุณ</p>

              <div className={c.copySection}>
                <label className={c.copyLabel}>Message ID (เก็บไว้สำหรับแก้ไขภายหลัง)</label>
                <div className="flex gap-2">
                  <input readOnly value={submitted.messageId} className={c.copyInput} />
                  <button type="button" onClick={copyMessageId} className={c.copyButton}>
                    {copied ? '✓ คัดลอกแล้ว' : '📋 คัดลอก'}
                  </button>
                </div>
                <p className={c.copyHint}>
                  💡 คัดลอก ID นี้ไว้ก่อนปิดหน้าเว็บ ถ้าต้องการแก้ไขข้อมูลครั้งต่อไป
                </p>
              </div>

              <div className="flex flex-wrap justify-center gap-3">
                <button type="button" onClick={resetForm} className={c.resetButton}>
                  <span className="text-lg">🔄</span> สมัครใหม่
                </button>
                <button
                  type="button"
                  onClick={editSubmitted}
                  className={c.editAfterSuccessButton}
                >
                  ✎ แก้ไขข้อมูลนี้
                </button>
              </div>
            </div>
          ) : (
            <div className={c.card}>
              <div className={c.header}>
                <div className={c.headerIcon}>💚</div>
                <h2 className={c.headerTitle}>สมัครเป็นแพทย์</h2>
                <p className={c.headerDesc}>กรอกข้อมูลด้านล่างเพื่อสมัครเข้าร่วมหน่วยแพทย์ VES-PD</p>
              </div>

              <DiscordConnectPanel auth={auth} />

              {auth.failed && (
                <ErrorBox errors={['เชื่อมต่อ Discord ล้มเหลว กรุณาลองใหม่อีกครั้ง']} />
              )}

              <form onSubmit={submit} className="flex flex-col gap-6">
                <DiscordIdField userId={auth.user?.userId ?? ''} />

                <EditToggle editMode={editMode} onToggle={() => void startEdit()} />

                {editMode && (
                  <EditSection
                    messageId={messageId}
                    onMessageIdChange={setMessageId}
                    onFetch={loadExisting}
                    fetching={loadingText !== null}
                    lookup={lookup}
                    cancelLabel={lookup?.status === 'found' ? 'ล้างการแก้ไข' : 'ยกเลิก'}
                    onCancel={() => {
                      // Same reasoning as the police form.
                      if (lookup?.status === 'found') {
                        void startEdit();
                        return;
                      }
                      exitEditMode();
                    }}
                  />
                )}

                <Field icon="📋" label="ชื่อ - นามสกุล (IC / ตามบัตร)">
                  <div className="flex gap-3 max-[480px]:flex-col max-[480px]:gap-4">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <FormInput
                        value={form.icFirstName}
                        onChange={set('icFirstName')}
                        placeholder="First Name"
                        maxLength={50}
                        required
                      />
                      <span className={c.hintSmall}>ชื่อจริง (ห้ามเว้นวรรค)</span>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <FormInput
                        value={form.icLastName}
                        onChange={set('icLastName')}
                        placeholder="Last Name"
                        maxLength={50}
                        required
                      />
                      <span className={c.hintSmall}>นามสกุล (ห้ามเว้นวรรค)</span>
                    </div>
                  </div>
                </Field>

                <Field icon="🎂" label="อายุ (OC)" hint="อายุของตัวละครในเกม">
                  <FormInput
                    type="number"
                    value={form.ocAge}
                    onChange={set('ocAge')}
                    placeholder="กรอกอายุตัวละคร"
                    min={1}
                    max={120}
                    required
                  />
                </Field>

                {/* v2's .time-range-group: its own red-tinted block */}
                <div className="flex flex-col gap-2 rounded-md border border-danger/15 bg-danger/5 p-4">
                  <label className="mb-1 flex items-center gap-2 text-sm font-semibold text-danger">
                    <span className="text-lg">⏰</span>
                    เวลาที่สามารถปฏิบัติหน้าที่ได้
                  </label>

                  <div className="flex items-center gap-4 max-[640px]:gap-2 max-[400px]:flex-col max-[400px]:items-stretch max-[400px]:gap-3">
                    <div className="flex flex-1 flex-col gap-1.5">
                      <input
                        type="time"
                        value={form.timeStart}
                        onChange={set('timeStart')}
                        required
                        className={TIME_INPUT}
                      />
                      <span className="text-center text-xs font-medium text-ink-dim">เริ่ม</span>
                    </div>

                    <span className="mt-5 shrink-0 text-xl font-semibold text-ink-dim/50 max-[640px]:text-base max-[400px]:hidden">
                      —
                    </span>

                    <div className="flex flex-1 flex-col gap-1.5">
                      <input
                        type="time"
                        value={form.timeEnd}
                        onChange={set('timeEnd')}
                        required
                        className={TIME_INPUT}
                      />
                      <span className="text-center text-xs font-medium text-ink-dim">สิ้นสุด</span>
                    </div>
                  </div>

                  <span className={c.hint}>
                    เลือกช่วงเวลาที่สามารถออนไลน์และปฏิบัติหน้าที่ได้ เช่น 18:00 - 00:00
                  </span>
                </div>

                <Field
                  icon="🩺"
                  label="มีประสบการณ์ด้านสายแพทย์มาก่อนหรือไม่ (โปรดระบุ)"
                  hint='ระบุประสบการณ์หรือความรู้ด้านสายแพทย์ที่มี (ถ้าไม่มีให้ระบุว่า "ไม่มี")'
                >
                  <FormTextArea
                    value={form.medicalExperience}
                    onChange={set('medicalExperience')}
                    placeholder="เช่น เคยเป็นแพทย์ในเซิร์ฟอื่น, มีความรู้ด้านการรักษา, เคยผ่านการฝึกอบรม..."
                    rows={4}
                    maxLength={500}
                    required
                  />
                </Field>

                <Field
                  icon="💡"
                  label="เหตุผลที่ต้องการเข้าร่วมหน่วยแพทย์"
                  hint="เขียนเหตุผลที่ต้องการเข้าร่วมหน่วยแพทย์ VES-PD"
                >
                  <FormTextArea
                    value={form.joinReason}
                    onChange={set('joinReason')}
                    placeholder="บอกเหตุผลที่อยากเข้าร่วมหน่วยแพทย์ของเรา..."
                    rows={4}
                    maxLength={500}
                    required
                  />
                </Field>

                {notice && <ErrorBox errors={notice.messages} tone={notice.tone} />}

                <SubmitBar
                  editMode={editMode}
                  pending={loadingText !== null}
                  disabled={!auth.user}
                  label="สมัครสมาชิก"
                  tone="danger"
                />

                {!auth.user && (
                  <RequiredDiscordNote>กรุณาเชื่อมต่อ Discord ก่อนสมัคร</RequiredDiscordNote>
                )}
              </form>
            </div>
          )}
        </div>
      </main>

      <SiteFooter department="VES-PD MEDICAL DEPARTMENT" />

      {loadingText && <LoadingOverlay text={loadingText} />}
    </div>
  );
}
