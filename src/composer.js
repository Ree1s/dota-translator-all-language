// Main-process controller: no game input simulation, and no clipboard changes until Copy.
export function createComposer({ translate, clipboard }) {
  let busy = false, result = '';
  let previous = null, copied = '';
  return {
    async translate(payload) {
      if (busy) return { ok: false, why: '正在翻译，请稍候。' };
      const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
      const language = payload?.language, style = payload?.style;
      if (!text || text.length > 200) return { ok: false, why: '请输入 1–200 个字符。' };
      if (!['English', 'Russian', 'Filipino'].includes(language) || !['faithful', 'savage'].includes(style)) return { ok: false, why: '请选择语言和风格。' };
      busy = true; result = '';
      try { result = (await translate(text, language, style)).out; return { ok: true, out: result }; }
      catch { return { ok: false, why: '翻译失败。请检查设置里的 Gemini 密钥和网络，然后重试。' }; }
      finally { busy = false; }
    },
    copy() {
      if (busy || !result) return false;
      if (previous === null || clipboard.readText() !== copied) previous = clipboard.readText();
      copied = result;
      clipboard.writeText(result);
      return true;
    },
    restore() {
      if (previous === null) return false;
      const unchanged = clipboard.readText() === copied;
      if (unchanged) clipboard.writeText(previous);
      previous = null; copied = '';
      return unchanged;
    },
  };
}
