export interface DebouncedSaver {
  schedule: (markdown: string) => void;
  flush: () => Promise<void>;
  pending: () => boolean;
}

/**
 * 串行的 400ms 防抖保存器。
 *
 * 保存过程中继续输入不会覆盖正在写入的版本；下一次 flush 会排在前一次写入之后，
 * 因此切换文档和关窗时可以可靠等待最后一版落盘。
 */
export function createDebouncedSaver(
  save: (markdown: string) => Promise<void>,
  delay = 400,
): DebouncedSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingMarkdown: string | null = null;
  let writeChain = Promise.resolve();

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pendingMarkdown === null) return writeChain;

    const markdown = pendingMarkdown;
    pendingMarkdown = null;
    // 一次失败不能把 Promise 链永久置为 rejected；调用本次 flush 的人仍会
    // 收到错误，但下一次输入可以继续尝试落盘。
    writeChain = writeChain
      .catch(() => undefined)
      .then(() => save(markdown))
      .catch((error) => {
        // 没有更新版本在等待时，把失败版本放回队列。这样自动保存失败后再
        // blur / Ctrl+S / 关窗仍会重试，不会因组件卸载静默丢字。
        if (pendingMarkdown === null) pendingMarkdown = markdown;
        throw error;
      });
    return writeChain;
  };

  return {
    schedule(markdown) {
      pendingMarkdown = markdown;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // 自动防抖保存没有直接调用方可接错误；store 会记录错误状态，下一次
        // schedule 仍能重试。显式 blur / 切换 / 关窗 flush 则会正常抛错。
        void flush().catch(() => undefined);
      }, delay);
    },
    flush,
    pending: () => pendingMarkdown !== null,
  };
}
