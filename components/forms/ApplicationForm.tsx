'use client';

/* eslint-disable @next/next/no-img-element */

/* Shared pieces for the police/medical application pages, matching v2's
   register.css / medical.css element for element: icon+hint on every field,
   the Discord connect panel that turns green once linked, the read-only
   Discord ID field with its live status pill, and the gold-tinted edit mode. */

import type { DiscordAuthState } from '@/lib/client/useDiscordAuth';
import { DiscordIcon } from './DiscordIcon';

/** Shared class strings; `accent` swaps the teal treatment for medical's red. */
export const applicationPageClasses = {
  page: 'flex min-h-screen flex-col',
  main: 'flex flex-1 items-center justify-center px-5 py-10 max-[640px]:px-4 max-[640px]:py-5',

  card: 'panel animate-[fadeInUp_0.6s_ease] p-10 shadow-[0_20px_60px_rgba(0,0,0,0.3)] max-[640px]:p-6',
  header: 'mb-8 text-center',
  headerIcon: 'mb-4 animate-[heroPulse_2s_infinite] text-[48px] max-[640px]:text-[40px]',
  headerTitle: 'mb-2 text-[28px] font-bold text-accent max-[640px]:text-[24px]',
  headerDesc: 'text-sm text-ink-dim',

  hint: 'pl-1 text-xs text-ink-dim/50',
  hintSmall: 'text-[11px] text-ink-dim/50',

  successCard:
    'panel animate-[fadeInUp_0.6s_ease] px-10 py-[60px] text-center shadow-[0_20px_60px_rgba(0,0,0,0.3)] max-[640px]:px-6',
  successIcon: 'mb-6 animate-[bounceIn_0.6s_ease] text-[64px] text-success',
  successTitle: 'mb-4 text-[28px] font-bold text-success',
  successText: 'mb-2 text-base text-ink-dim',
  successNote: 'mb-8 text-sm text-ink-dim/50',

  copySection: 'my-6 rounded-md border border-[#3b82f6]/20 bg-[#3b82f6]/8 p-[18px]',
  copyLabel: 'mb-2.5 block text-left text-[13px] font-semibold text-ink-dim',
  copyInput:
    'min-w-0 flex-1 rounded-md border border-accent/12 bg-black/20 px-3.5 py-3 text-center font-eng text-[13px] tracking-[0.5px] text-ink outline-none',
  copyButton:
    'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-[#3b82f6]/30 bg-[#3b82f6]/20 px-4.5 py-2.5 text-[13px] font-semibold whitespace-nowrap text-[#60A5FA] transition hover:bg-[#3b82f6]/35',
  copyHint: 'mt-2 text-[11px] text-ink-dim/50',

  resetButton:
    'inline-flex cursor-pointer items-center gap-2 rounded-md border border-accent/12 bg-transparent px-6 py-3 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent',
  editAfterSuccessButton:
    'inline-flex cursor-pointer items-center gap-2 rounded-md border border-gold/30 bg-gold/15 px-6 py-3 text-sm font-semibold text-gold transition hover:border-gold hover:bg-gold/25',
} as const;

const INPUT_CLASS =
  'w-full rounded-md border border-accent/12 bg-white/5 px-4 py-3.5 text-[15px] text-ink outline-none transition placeholder:text-ink-dim/50 hover:border-accent/30 focus:border-accent focus:bg-accent/10 focus:shadow-[0_0_0_3px_rgba(220,109,11,0.1)] max-[640px]:px-3.5 max-[640px]:py-3 max-[640px]:text-sm';

export function FormInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT_CLASS} ${props.className ?? ''}`} />;
}

export function FormTextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${INPUT_CLASS} min-h-24 resize-y ${props.className ?? ''}`}
    />
  );
}

export function Field({
  icon,
  label,
  hint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="text-lg">{icon}</span>
        {label}
      </label>
      {children}
      {hint && <span className={applicationPageClasses.hint}>{hint}</span>}
    </div>
  );
}

/** v2's .discord-login-section — blue while disconnected, green once linked. */
export function DiscordConnectPanel({ auth }: { auth: DiscordAuthState }) {
  const connected = Boolean(auth.user);

  return (
    <div
      className={`mb-8 rounded-lg border p-6 text-center transition ${
        connected
          ? 'border-success/30 bg-gradient-to-br from-success/10 to-success/5'
          : 'border-[#5865F2]/20 bg-gradient-to-br from-[#5865F2]/10 to-[#5865F2]/5'
      }`}
    >
      <div
        className={`mb-2 flex items-center justify-center gap-2.5 text-base font-semibold ${
          connected ? 'text-success' : 'text-[#5865F2]'
        }`}
      >
        <DiscordIcon size={28} />
        <span>เชื่อมต่อบัญชี Discord</span>
      </div>

      {connected ? (
        <div className="flex animate-[fadeIn_0.3s_ease] items-center gap-4 rounded-md border border-success/30 bg-success/10 px-5 py-4">
          <img
            src={auth.avatarUrl ?? ''}
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded-full border-[3px] border-success"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-left">
            <span className="truncate text-base font-bold text-ink">@{auth.user!.name}</span>
            <span className="truncate font-eng text-[13px] text-ink-dim">{auth.user!.userId}</span>
          </div>
          <button
            type="button"
            onClick={auth.disconnect}
            title="ยกเลิกการเชื่อมต่อ"
            aria-label="ยกเลิกการเชื่อมต่อ"
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-danger/30 bg-danger/15 text-danger transition hover:scale-110 hover:bg-danger/30"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          <p className="mb-4 text-[13px] text-ink-dim">กรุณาเชื่อมต่อ Discord ก่อนกรอกข้อมูล</p>
          {/* Plain anchor: /auth/discord redirects off to discord.com, which
              next/link would try to prefetch cross-origin and fail on. */}
          <a
            href={auth.loginUrl}
            className="inline-flex cursor-pointer items-center justify-center gap-2.5 rounded-md bg-gradient-to-br from-[#5865F2] to-[#4752C4] px-8 py-3.5 text-[15px] font-bold text-white shadow-[0_4px_15px_rgba(88,101,242,0.3)] transition hover:-translate-y-0.5 hover:from-[#4752C4] hover:to-[#3C45A5] hover:shadow-[0_8px_25px_rgba(88,101,242,0.5)]"
          >
            <DiscordIcon size={24} /> เชื่อมต่อ Discord
          </a>
        </>
      )}
    </div>
  );
}

/** Read-only Discord ID with the status pill v2 shows inside the field. */
export function DiscordIdField({ userId }: { userId: string }) {
  const connected = Boolean(userId);

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="text-lg text-[#5865F2]">
          <DiscordIcon size={18} />
        </span>
        Discord ID
      </label>

      <div className="relative">
        <input
          readOnly
          value={userId}
          placeholder="กดปุ่มเชื่อมต่อ Discord เพื่อรับ ID"
          className="w-full rounded-md border border-[#5865F2]/25 bg-[#5865F2]/8 py-3.5 pr-[140px] pl-4 font-eng text-[15px] text-ink outline-none transition placeholder:font-thai placeholder:text-ink-dim/50"
        />
        <div
          className={`absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
            connected
              ? 'border-success/30 bg-success/15 text-success'
              : 'border-danger/30 bg-danger/15 text-danger'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              connected ? 'bg-success' : 'animate-[pulseDot_2s_infinite] bg-danger'
            }`}
          />
          <span className="font-medium whitespace-nowrap">
            {connected ? 'เชื่อมต่อแล้ว' : 'ยังไม่ได้เชื่อมต่อ'}
          </span>
        </div>
      </div>

      <span className={applicationPageClasses.hint}>
        ID จะถูกกรอกอัตโนมัติหลังจากเชื่อมต่อ Discord
      </span>
    </div>
  );
}

export function EditToggle({ editMode, onToggle }: { editMode: boolean; onToggle: () => void }) {
  if (editMode) return null;

  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-gold/40 bg-gold/10 px-5 py-2.5 text-[13px] font-semibold text-gold transition hover:border-solid hover:border-gold hover:bg-gold/[0.18]"
    >
      ✎ แก้ไขข้อมูล
    </button>
  );
}

/** How the automatic lookup of the signed-in account's own application went.
    Absent on the medical form, which has no sheet to look in — it gets the
    manual field exactly as before. */
export interface EditLookup {
  status: 'loading' | 'found' | 'missing';
  /** Why it could not be found: shown above the manual fallback. */
  message: string;
}

export function EditSection({
  messageId,
  onMessageIdChange,
  onFetch,
  fetching,
  onCancel,
  cancelLabel = 'ยกเลิก',
  lookup,
}: {
  messageId: string;
  onMessageIdChange: (value: string) => void;
  onFetch: () => void;
  fetching: boolean;
  onCancel: () => void;
  /** Leaving the editor means different things depending on whether there is
      an application to leave it to — see the forms. */
  cancelLabel?: string;
  lookup?: EditLookup | null;
}) {
  /* The id is only asked for when it could not be found automatically — which
     is every medical edit, and a registration whose row predates the column
     that records it. */
  const askForId = !lookup || lookup.status === 'missing';

  return (
    <div className="animate-[fadeIn_0.3s_ease] rounded-md border border-gold/15 bg-gold/5 p-4">
      <div className="flex items-center gap-2.5 rounded-md border border-gold/30 bg-gold/[0.12] px-4 py-3 text-sm font-semibold text-gold">
        <span className="text-lg">✎</span>
        <span>กำลังแก้ไขข้อมูล</span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto cursor-pointer rounded-sm border border-danger/30 bg-danger/15 px-3.5 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger/30"
        >
          {cancelLabel}
        </button>
      </div>

      {lookup?.status === 'loading' && (
        <div className="mt-4 flex items-center gap-2 text-[13px] text-ink-dim">
          <span>⏳</span> กำลังค้นหาใบสมัครของคุณ
        </div>
      )}

      {lookup?.status === 'found' && (
        <div className="mt-4 flex items-start gap-2 text-[13px] leading-relaxed text-success">
          <span className="shrink-0">✅</span>
          <span>พบใบสมัครของคุณแล้ว — โหลดข้อมูลขึ้นฟอร์มให้เรียบร้อย แก้ไขแล้วกดบันทึกได้เลย</span>
        </div>
      )}

      {lookup?.status === 'missing' && lookup.message && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-gold/25 bg-gold/10 px-3 py-2.5 text-[12px] leading-relaxed text-gold">
          <span className="shrink-0">💡</span>
          <span>{lookup.message}</span>
        </div>
      )}

      <div className={`mt-4 flex-col gap-2 ${askForId ? 'flex' : 'hidden'}`}>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="text-lg">📄</span> Message ID
        </label>

        <div className="flex gap-2">
          <input
            value={messageId}
            onChange={(e) => onMessageIdChange(e.target.value)}
            placeholder="วาง Message ID ที่คัดลอกจาก Discord"
            className="min-w-0 flex-1 rounded-md border border-gold/25 bg-gold/8 px-4 py-3.5 font-eng text-sm text-ink outline-none transition placeholder:font-thai placeholder:text-[13px] placeholder:text-ink-dim/50 focus:border-gold focus:bg-gold/[0.12] focus:shadow-[0_0_0_3px_rgba(251,191,36,0.15)]"
          />
          <button
            type="button"
            onClick={onFetch}
            disabled={fetching}
            className="flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#3b82f6]/30 bg-[#3b82f6]/15 px-4.5 py-2.5 text-[13px] font-semibold whitespace-nowrap text-[#60A5FA] transition hover:bg-[#3b82f6]/25 disabled:opacity-50"
          >
            {fetching ? '⏳ กำลังโหลด' : '📥 โหลดข้อมูล'}
          </button>
        </div>

        <div className="flex items-start gap-1.5 px-1 py-1.5 text-[11px] leading-relaxed text-ink-dim/50">
          <span className="shrink-0 text-[13px]">💡</span>
          <span>
            เปิด Discord → Settings → Advanced → เปิด Developer Mode → คลิกขวาที่ embed → Copy
            Message ID
          </span>
        </div>
      </div>
    </div>
  );
}

export function ErrorBox({
  errors,
  tone = 'error',
}: {
  errors: string[];
  tone?: 'error' | 'success';
}) {
  if (errors.length === 0) return null;

  const success = tone === 'success';

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-md border p-4 ${
        success ? 'border-success/30 bg-success/10' : 'border-danger/30 bg-danger/10'
      }`}
    >
      <span className="shrink-0 text-xl">{success ? '✅' : '⚠'}</span>
      <ul className="space-y-1">
        {errors.map((error, i) => (
          <li
            key={i}
            className={`text-sm leading-relaxed ${success ? 'text-success' : 'text-danger'}`}
          >
            • {error}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Teal by default; gold in edit mode; red for the medical form. */
export function SubmitBar({
  editMode,
  pending,
  disabled,
  label,
  tone = 'accent',
}: {
  editMode: boolean;
  pending: boolean;
  disabled: boolean;
  label: string;
  tone?: 'accent' | 'danger';
}) {
  const gradient = editMode
    ? 'from-gold to-[#D97706] text-night shadow-[0_4px_15px_rgba(251,191,36,0.3)] hover:shadow-[0_8px_25px_rgba(251,191,36,0.4)]'
    : tone === 'danger'
      ? 'from-danger to-[#dc2626] text-white hover:shadow-[0_10px_30px_rgba(239,68,68,0.3)]'
      : 'from-accent to-accent-dark text-black hover:shadow-[0_10px_30px_rgba(220,109,11,0.3)]';

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={`mt-2 flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-md bg-gradient-to-br px-6 py-4 text-base font-bold transition hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none max-[640px]:px-5 max-[640px]:py-3.5 max-[640px]:text-[15px] ${gradient}`}
    >
      <span className="text-lg">{editMode ? '✎' : '✓'}</span>
      <span>{pending ? 'กำลังส่ง...' : editMode ? 'บันทึกการแก้ไข' : label}</span>
    </button>
  );
}

export function RequiredDiscordNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex animate-[fadeIn_0.3s_ease] items-center justify-center gap-2 rounded-md border border-gold/30 bg-gold/10 px-4 py-3 text-[13px] font-medium text-gold">
      <span className="text-base">💡</span>
      {children}
    </div>
  );
}
