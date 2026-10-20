'use client';

/* Admin CRUD for conduct/rules/fines — ported from v2's AdminPanel.js.
   Orange (#f77f07) throughout, matching the admin-mode color already used on
   PinModal: a deliberate visual break from the site's teal "public" theme. */

import { useId, useRef, useState } from 'react';
import type { RulesType } from '@/lib/types';

const ID_PREFIX: Record<RulesType, string> = { rules: 'r', conduct: 'co', fines: 'fi' };

/** Server requires `id` in the POST body, so v2 generates it client-side. */
export function generateRuleId(type: RulesType): string {
  const suffix = Date.now().toString(36).slice(-6);
  const random = Math.random().toString(36).slice(2, 4);
  return `${ID_PREFIX[type]}-${suffix}${random}`;
}

/** conduct's category field is literally `title`; rules/fines use `category`. */
export function collectCategories(
  items: Array<{ category?: string; title?: string }>,
  type: RulesType
): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const value = type === 'conduct' ? item.title : item.category;
    if (value) set.add(value);
  }
  return [...set];
}

export function AdminBar({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#f77f07]/30 bg-[#f77f07]/10 px-5 py-2.5">
      <span className="text-xs font-bold text-[#f77f07]">🔧 โหมดผู้ดูแล</span>
      <button
        type="button"
        onClick={onAdd}
        className="cursor-pointer rounded-md bg-[#2ecc71] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#27ae60]"
      >
        + เพิ่มข้อมูล
      </button>
    </div>
  );
}

export function AdminItemActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="flex shrink-0 items-start gap-1">
      <button
        type="button"
        onClick={onEdit}
        title="แก้ไข"
        aria-label="แก้ไข"
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-[#3b82f6]/20 text-sm text-[#3b82f6] transition hover:bg-[#3b82f6]/30"
      >
        ✏️
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="ลบ"
        aria-label="ลบ"
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-[#ef4444]/20 text-sm text-[#ef4444] transition hover:bg-[#ef4444]/30"
      >
        🗑️
      </button>
    </span>
  );
}

export interface RuleFormFields {
  category: string;
  text: string;
  amount: string;
  time: string;
}

/** No backdrop-click-to-close — v2 deliberately requires an explicit
    Cancel/× click so a stray click can't discard unsaved typing. */
function AdminModalBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4 backdrop-blur-[5px]">
      <div className="w-full max-w-[450px] rounded-2xl border border-[#f77f07]/30 bg-[#1a1a2e] p-[30px] shadow-2xl">
        {children}
      </div>
    </div>
  );
}

export function RuleFormModal({
  type,
  mode,
  initial,
  categories,
  pending,
  onSave,
  onClose,
}: {
  type: RulesType;
  mode: 'add' | 'edit';
  initial: RuleFormFields;
  categories: string[];
  pending: boolean;
  onSave: (values: RuleFormFields) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState(initial.category);
  const [text, setText] = useState(initial.text);
  const [amount, setAmount] = useState(initial.amount);
  const [time, setTime] = useState(initial.time);
  const [boldOn, setBoldOn] = useState(false);
  const [colorOn, setColorOn] = useState(false);
  const [colorValue, setColorValue] = useState('#ff0000');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  /* Wraps the current textarea selection — color span first (inner), bold tag
     second (outer) — exactly matching v2's applyFormat(). */
  function applyFormat() {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = el.value.substring(start, end);
    if (!selected) return;

    let replacement = selected;
    if (colorOn) replacement = `<span style="color:${colorValue}">${replacement}</span>`;
    if (boldOn) replacement = `<b>${replacement}</b>`;

    el.setRangeText(replacement, start, end, 'end');
    setText(el.value);
    el.focus();
  }

  return (
    <AdminModalBackdrop>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-[#f77f07]">
          {mode === 'add' ? '+ เพิ่มข้อมูล' : '✏️ แก้ไขข้อมูล'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          className="cursor-pointer text-2xl leading-none text-ink-dim hover:text-ink"
        >
          ×
        </button>
      </div>

      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-semibold text-ink-dim">
          ประเภท / Category
        </label>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          list={listId}
          placeholder="พิมพ์ประเภทเอง เช่น กฎทั่วไป..."
          className="w-full rounded-lg border border-[#333] bg-[#0a0a0a] px-3 py-2.5 font-thai text-sm text-white outline-none focus:border-[#f77f07]"
        />
        <datalist id={listId}>
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-semibold text-ink-dim">เนื้อหา / Text</label>

        <div className="mb-1.5 flex items-center gap-1.5 rounded-lg border border-[#333] bg-[#0a0a0a] px-2.5 py-1.5">
          <button
            type="button"
            onClick={() => setBoldOn((v) => !v)}
            title="ตัวหนา"
            className={`cursor-pointer rounded-md border px-3 py-1 text-sm font-semibold transition active:scale-95 ${
              boldOn
                ? 'border-[#f77f07] bg-[#f77f07] text-white'
                : 'border-[#444] bg-[#1a1f2e] text-[#e2e8f0] hover:border-[#f77f07]'
            }`}
          >
            <b>B</b>
          </button>
          <button
            type="button"
            onClick={() => setColorOn((v) => !v)}
            title="เลือกสี"
            className={`cursor-pointer rounded-md border px-3 py-1 text-sm font-semibold transition active:scale-95 ${
              colorOn
                ? 'border-[#f77f07] bg-[#f77f07] text-white'
                : 'border-[#444] bg-[#1a1f2e] text-[#e2e8f0] hover:border-[#f77f07]'
            }`}
          >
            A
          </button>
          <input
            type="color"
            value={colorValue}
            onChange={(e) => setColorValue(e.target.value)}
            title="เลือกสี"
            className="h-8 w-8 cursor-pointer rounded border-none p-0"
          />
          <button
            type="button"
            onClick={applyFormat}
            className="cursor-pointer rounded-md border border-[#2ecc71] bg-[#2ecc71] px-3 py-1 text-sm font-semibold text-white transition hover:bg-[#27ae60]"
          >
            ▶ ใช้
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="กรอกเนื้อหา..."
          rows={5}
          className="w-full resize-y rounded-lg border border-[#333] bg-[#0a0a0a] px-3 py-2.5 font-thai text-sm text-white outline-none focus:border-[#f77f07]"
        />
      </div>

      {type === 'fines' && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink-dim">
              ค่าปรับ (บาท)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-[#333] bg-[#0a0a0a] px-3 py-2.5 text-sm text-white outline-none focus:border-[#f77f07]"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink-dim">เวลา (นาที)</label>
            <input
              type="number"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-[#333] bg-[#0a0a0a] px-3 py-2.5 text-sm text-white outline-none focus:border-[#f77f07]"
            />
          </div>
        </div>
      )}

      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 cursor-pointer rounded-lg bg-[#333] py-2.5 text-sm font-semibold text-white transition hover:bg-[#444]"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          disabled={pending || !text.trim()}
          onClick={() => onSave({ category, text, amount, time })}
          className="flex-1 cursor-pointer rounded-lg bg-[#f77f07] py-2.5 text-sm font-semibold text-white transition hover:bg-[#e67300] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
      </div>
    </AdminModalBackdrop>
  );
}

export function RuleDeleteModal({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AdminModalBackdrop>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-[#f77f07]">🗑️ ยืนยันการลบ</h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="ปิด"
          className="cursor-pointer text-2xl leading-none text-ink-dim hover:text-ink"
        >
          ×
        </button>
      </div>
      <p className="mb-5 text-sm text-ink-dim">
        คุณต้องการลบรายการนี้หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้
      </p>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 cursor-pointer rounded-lg bg-[#333] py-2.5 text-sm font-semibold text-white transition hover:bg-[#444]"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onConfirm}
          className="flex-1 cursor-pointer rounded-lg bg-[#ef4444] py-2.5 text-sm font-semibold text-white transition hover:bg-[#dc2626] disabled:opacity-50"
        >
          {pending ? 'กำลังลบ...' : 'ลบข้อมูล'}
        </button>
      </div>
    </AdminModalBackdrop>
  );
}
