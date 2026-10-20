'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mutations } from '@/lib/client/queries';
import { useDiscordAuth } from '@/lib/client/useDiscordAuth';
import { useToast } from '@/components/ui/Toast';
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
  RequiredDiscordNote,
  SubmitBar,
  applicationPageClasses,
} from './ApplicationForm';

interface FormState {
  ocName: string;
  icFirstName: string;
  icLastName: string;
  ocAge: string;
  icPhone: string;
  steamUrl: string;
}

const EMPTY: FormState = {
  ocName: '',
  icFirstName: '',
  icLastName: '',
  ocAge: '',
  icPhone: '',
  steamUrl: '',
};

export function RegisterForm() {
  const auth = useDiscordAuth('register');
  const toast = useToast();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [savedMessageId, setSavedMessageId] = useState<string | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [lookup, setLookup] = useState<EditLookup | null>(null);
  const [messageId, setMessageId] = useState('');
  const [editCount, setEditCount] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(false);
  const [copied, setCopied] = useState(false);

  /** Which account has already been looked up, so connecting does it once. */
  const checkedFor = useRef<string | null>(null);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  /** Drops a submission read back out of Discord into the form. */
  const applyLoaded = useCallback(
    (result: {
      data: { ocName: string; icName: string; ocAge: number; icPhone: string; steamUrl: string };
      editCount: number;
      messageId: string;
    }) => {
      const [first = '', ...rest] = (result.data.icName || '').split(' ');

      setForm({
        ocName: result.data.ocName,
        icFirstName: first,
        icLastName: rest.join(' '),
        ocAge: result.data.ocAge ? String(result.data.ocAge) : '',
        icPhone: result.data.icPhone,
        steamUrl: result.data.steamUrl,
      });
      setEditCount(result.editCount);
      setMessageId(result.messageId);
    },
    []
  );

  /**
   * Connecting Discord is now enough to find an earlier application: the id is
   * looked up from the session, so someone who has applied before lands in the
   * editor rather than filing a second one. Finding nothing — no row, or a row
   * from before the id was recorded — means this is a first application, and
   * the page carries on exactly as it did.
   */
  useEffect(() => {
    const userId = auth.user?.userId;
    if (!userId || checkedFor.current === userId) return;
    checkedFor.current = userId;

    let alive = true;
    setCheckingExisting(true);

    mutations
      .myRegistration()
      .then((result) => {
        if (!alive) return;
        applyLoaded(result);
        setEditMode(true);
        setLookup({ status: 'found', message: '' });
        toast('พบใบสมัครเดิมของคุณ — โหลดข้อมูลขึ้นมาให้แล้ว', 'success');
      })
      .catch(() => {
        /* Nothing to edit; this is a new application. Not an error to report. */
      })
      .finally(() => {
        if (alive) setCheckingExisting(false);
      });

    return () => {
      alive = false;
    };
  }, [auth.user?.userId, applyLoaded, toast]);

  /**
   * Opening the editor now looks the application up by the Discord account the
   * request is signed in as, so nobody has to have kept the message id. An
   * application submitted before the sheet started recording that id falls
   * back to the field that asks for it.
   */
  async function startEdit() {
    setEditMode(true);
    setErrors([]);
    setLookup({ status: 'loading', message: '' });

    try {
      applyLoaded(await mutations.myRegistration());
      setLookup({ status: 'found', message: '' });
      toast('พบใบสมัครของคุณแล้ว', 'success');
    } catch (err) {
      setLookup({ status: 'missing', message: (err as Error).message });
    }
  }

  /** The fallback: an id pasted by hand. */
  async function loadExisting() {
    if (!messageId.trim()) {
      setErrors(['กรุณาระบุ Message ID']);
      return;
    }

    setFetching(true);
    setErrors([]);

    try {
      applyLoaded(await mutations.fetchRegister(messageId.trim(), auth.user?.userId));
      toast('โหลดข้อมูลสำเร็จ', 'success');
    } catch (err) {
      setErrors([(err as Error).message]);
    } finally {
      setFetching(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth.user) return;

    setPending(true);
    setErrors([]);

    const payload = {
      ocName: form.ocName,
      icName: `${form.icFirstName} ${form.icLastName}`.trim(),
      ocAge: Number(form.ocAge),
      icPhone: form.icPhone,
      steamUrl: form.steamUrl,
      discordId: auth.user.userId,
      discordUserId: auth.user.userId,
      discordDisplayName: auth.user.name,
    };

    try {
      if (editMode) {
        const result = await mutations.editRegister({
          ...payload,
          messageId: messageId.trim(),
          editCount,
        });
        setEditCount(result.editCount);
        toast(result.message, 'success');
      } else {
        const result = await mutations.register(payload);
        setSavedMessageId(result.messageId);
      }
    } catch (err) {
      setErrors([(err as Error).message]);
    } finally {
      setPending(false);
    }
  }

  async function copyMessageId() {
    if (!savedMessageId) return;
    try {
      await navigator.clipboard.writeText(savedMessageId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  const c = applicationPageClasses;

  if (savedMessageId) {
    return (
      <div className={c.page}>
        <SiteHeader />
        <main className={c.main}>
          <div className="w-full max-w-[600px]">
            <BackHome className="mb-3" />
            <div className={c.successCard}>
              <div className={c.successIcon}>✔</div>
              <h2 className={c.successTitle}>สมัครสำเร็จ!</h2>
              <p className={c.successText}>ข้อมูลการสมัครของคุณถูกส่งไปยังทีมงานเรียบร้อยแล้ว</p>
              <p className={c.successNote}>ทีมงานจะติดต่อกลับผ่าน Discord ของคุณ</p>

              <div className={c.copySection}>
                <label className={c.copyLabel}>Message ID (เก็บไว้สำหรับแก้ไขภายหลัง)</label>
                <div className="flex gap-2">
                  <input readOnly value={savedMessageId} className={c.copyInput} />
                  <button type="button" onClick={copyMessageId} className={c.copyButton}>
                    {copied ? '✓ คัดลอกแล้ว' : '📋 คัดลอก'}
                  </button>
                </div>
                <p className={c.copyHint}>
                  💡 คัดลอก ID นี้ไว้ก่อนปิดหน้าเว็บ ถ้าต้องการแก้ไขข้อมูลครั้งต่อไป
                </p>
              </div>

              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSavedMessageId(null);
                    setForm(EMPTY);
                    setEditMode(false);
                    setLookup(null);
                    setMessageId('');
                  }}
                  className={c.resetButton}
                >
                  <span className="text-lg">🔄</span> สมัครใหม่
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMessageId(savedMessageId);
                    setEditMode(true);
                    setLookup({ status: 'found', message: '' });
                    setSavedMessageId(null);
                  }}
                  className={c.editAfterSuccessButton}
                >
                  ✎ แก้ไขข้อมูลนี้
                </button>
              </div>
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className={c.page}>
      <SiteHeader />

      <main className={c.main}>
        <div className="w-full max-w-[600px]">
          <BackHome className="mb-3" />
          <div className={c.card}>
            <div className={c.header}>
              <div className={c.headerIcon}>⚖</div>
              <h2 className={c.headerTitle}>สมัครเป็นตำรวจ</h2>
              <p className={c.headerDesc}>กรอกข้อมูลด้านล่างเพื่อสมัครเข้าร่วมกรมตำรวจ VES-PD</p>
            </div>

            <DiscordConnectPanel auth={auth} />

            {auth.failed && <ErrorBox errors={['เชื่อมต่อ Discord ล้มเหลว กรุณาลองใหม่อีกครั้ง']} />}

            {checkingExisting && (
              <div className="flex items-center justify-center gap-2 rounded-md border border-gold/20 bg-gold/5 px-4 py-2.5 text-[13px] text-ink-dim">
                <span>⏳</span> กำลังตรวจสอบว่าคุณเคยสมัครไว้แล้วหรือไม่
              </div>
            )}

            <form onSubmit={submit} className="flex flex-col gap-6">
              <DiscordIdField userId={auth.user?.userId ?? ''} />

              <EditToggle editMode={editMode} onToggle={() => void startEdit()} />

              {editMode && (
                <EditSection
                  messageId={messageId}
                  onMessageIdChange={setMessageId}
                  onFetch={loadExisting}
                  fetching={fetching}
                  lookup={lookup}
                  cancelLabel={lookup?.status === 'found' ? 'ล้างการแก้ไข' : 'ยกเลิก'}
                  onCancel={() => {
                    /* With an application open there is nothing to leave the
                       editor *to*: dropping out of it used to leave the form
                       filled in and submittable, which filed a second one. So
                       here it means "throw my changes away", and reloads. */
                    if (lookup?.status === 'found') {
                      void startEdit();
                      return;
                    }
                    setEditMode(false);
                    setLookup(null);
                    setErrors([]);
                  }}
                />
              )}

              <Field icon="👤" label="ชื่อ เล่น IC" hint="ชื่อที่ให้เพื่อนเรียก">
                <FormInput
                  value={form.ocName}
                  onChange={set('ocName')}
                  placeholder="กรอกชื่อเล่น"
                  maxLength={50}
                  required
                />
              </Field>

              <Field icon="📋" label="ชื่อ IC / ชื่อตามบัตรประชาชน">
                <div className="flex flex-col gap-3 min-[481px]:flex-row min-[481px]:gap-3">
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

              <Field icon="🎂" label="อายุ OC" hint="อายุของตัวละครในเกม">
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

              <Field icon="📞" label="เบอร์ IC" hint="เบอร์โทรศัพท์ในเกม">
                <FormInput
                  value={form.icPhone}
                  onChange={set('icPhone')}
                  placeholder="เช่น 123-456-7890"
                  maxLength={20}
                  required
                />
              </Field>

              <Field icon="🎮" label="ลิงก์ Steam" hint="ลิงก์โปรไฟล์ Steam ของคุณ">
                <FormInput
                  type="url"
                  value={form.steamUrl}
                  onChange={set('steamUrl')}
                  placeholder="https://steamcommunity.com/id/yourname"
                  required
                />
              </Field>

              <ErrorBox errors={errors} />

              <SubmitBar
                editMode={editMode}
                pending={pending}
                disabled={!auth.user}
                label="สมัครสมาชิก"
              />

              {!auth.user && <RequiredDiscordNote>กรุณาเชื่อมต่อ Discord ก่อนสมัคร</RequiredDiscordNote>}
            </form>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
