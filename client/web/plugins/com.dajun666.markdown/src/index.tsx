import React, { useEffect, useRef, useState } from 'react';
import {
  getMessageTextDecorators,
  regChatInputButton,
  regChatInputPasteHandler,
  regMessageRender,
  regMessageTextDecorators,
  uploadFile,
} from '@capital/common';
import {
  BaseChatInputButton,
  Button,
  Icon,
  Markdown,
  notification,
  useChatInputActionContext,
} from '@capital/component';

const PLUGIN_ID = 'com.dajun666.markdown';
const PLUGIN_NAME = 'Markdown Enhancer';

console.log(`Plugin ${PLUGIN_NAME}(${PLUGIN_ID}) is loaded`);

regMessageRender((message) => <Markdown raw={message} />);

regMessageTextDecorators(() => ({
  url: (url, label) => (label ? `[${label}](${url})` : url),
  image: (plain) => `![image](${plain})`,
  card: (plain) => plain,
  mention: (_userId, userName) => `@${userName}`,
  emoji: (emojiCode) => `:${emojiCode}:`,
  serialize: (plain) => plain,
}));

const PENDING_PREFIX = 'pending://image/';
const ACCEPTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

type PendingImageStatus = 'pending' | 'uploading' | 'error';

interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
  status: PendingImageStatus;
  error?: string;
}

const pendingImages: PendingImage[] = [];
const listeners = new Set<(list: PendingImage[]) => void>();

function notifyPendingChange() {
  const snapshot = pendingImages.slice();
  listeners.forEach((listener) => listener(snapshot));
}

function subscribePendingImages(listener: (list: PendingImage[]) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function usePendingImages() {
  const [list, setList] = useState<PendingImage[]>(pendingImages.slice());

  useEffect(() => subscribePendingImages(setList), []);

  return list;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0B';
  const kb = 1024;
  if (bytes < kb) return `${bytes}B`;
  if (bytes < kb * kb) return `${(bytes / kb).toFixed(1)}KB`;
  return `${(bytes / (kb * kb)).toFixed(1)}MB`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPendingUrl(id: string) {
  return `${PENDING_PREFIX}${id}`;
}

function buildPendingMarkup(id: string) {
  return getMessageTextDecorators().image(buildPendingUrl(id), {});
}

function appendPendingMarkup(message: string, ids: string[]) {
  const additions = ids.map((id) => buildPendingMarkup(id)).join('\n');
  if (!message) return additions;

  const separator = message.endsWith('\n') ? '' : '\n';
  return `${message}${separator}${additions}`;
}

function stripPendingMarkup(message: string, id: string) {
  if (!message) return '';
  const pendingUrl = buildPendingUrl(id);
  const urlPattern = escapeRegExp(pendingUrl);
  const markdownPattern = new RegExp(`!\\[[^\\]]*\\]\\(${urlPattern}\\)`, 'g');
  const bbcodePattern = new RegExp(
    `\\[img[^\\]]*\\]${urlPattern}\\[/img\\]`,
    'g'
  );
  const plainPattern = new RegExp(urlPattern, 'g');

  const next = message
    .replace(markdownPattern, '')
    .replace(bbcodePattern, '')
    .replace(plainPattern, '');

  return next.replace(/\n{3,}/g, '\n\n').trim();
}

function createPendingImage(file: File): PendingImage {
  return {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    status: 'pending',
  };
}

function getImageFilesFromClipboard(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return [];
  const files = Array.from(dataTransfer.files ?? []);
  const items = Array.from(dataTransfer.items ?? []);
  const itemFiles = items
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  return [...files, ...itemFiles].filter((file) =>
    file.type.startsWith('image/')
  );
}

function enqueuePendingImages(
  files: File[],
  message: string,
  setMessage: (next: string) => void
) {
  const availableSlots = MAX_IMAGE_COUNT - pendingImages.length;
  if (availableSlots <= 0) {
    notification.warning({
      message: 'Too many images',
      description: `Max pending images: ${MAX_IMAGE_COUNT}.`,
    });
    return;
  }

  const accepted: File[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      rejected.push(`${file.name || 'image'}: unsupported type`);
      continue;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      rejected.push(
        `${file.name || 'image'}: larger than ${formatBytes(MAX_IMAGE_SIZE)}`
      );
      continue;
    }
    accepted.push(file);
    if (accepted.length >= availableSlots) break;
  }

  if (rejected.length > 0) {
    notification.warning({
      message: 'Some images were skipped',
      description: rejected.join('\n'),
    });
  }

  if (accepted.length === 0) return;

  const added = accepted.map(createPendingImage);
  pendingImages.push(...added);
  notifyPendingChange();

  const nextMessage = appendPendingMarkup(
    message,
    added.map((item) => item.id)
  );
  setMessage(nextMessage);
}

function removePendingImage(id: string) {
  const index = pendingImages.findIndex((item) => item.id === id);
  if (index === -1) return;
  const [item] = pendingImages.splice(index, 1);
  URL.revokeObjectURL(item.previewUrl);
  notifyPendingChange();
}

function clearPendingImages() {
  pendingImages.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  pendingImages.splice(0, pendingImages.length);
  notifyPendingChange();
}

function isChatInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('.chatbox-mention-input'));
}

async function getImageSize(previewUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = (event) => {
      reject(new Error(`Failed to load image size: ${String(event)}`));
    };
    img.src = previewUrl;
  });
}

async function uploadPendingImage(item: PendingImage) {
  item.status = 'uploading';
  item.error = undefined;
  notifyPendingChange();

  try {
    const { width, height } = await getImageSize(item.previewUrl);
    const fileInfo = await uploadFile(item.file, { usage: 'chat' });

    item.status = 'pending';
    notifyPendingChange();

    return {
      id: item.id,
      url: fileInfo.url,
      width,
      height,
    };
  } catch (err) {
    item.status = 'error';
    item.error = err instanceof Error ? err.message : String(err);
    notifyPendingChange();
    throw err;
  }
}

function replacePendingMarkup(
  message: string,
  uploaded: Array<{ id: string; url: string; width: number; height: number }>
) {
  let next = message;

  uploaded.forEach(({ id, url, width, height }) => {
    const pendingUrl = buildPendingUrl(id);
    const decorated = getMessageTextDecorators().image(url, { width, height });
    const urlPattern = escapeRegExp(pendingUrl);
    const markdownPattern = new RegExp(
      `!\\[[^\\]]*\\]\\(${urlPattern}\\)`,
      'g'
    );
    const bbcodePattern = new RegExp(
      `\\[img[^\\]]*\\]${urlPattern}\\[/img\\]`,
      'g'
    );
    const plainPattern = new RegExp(urlPattern, 'g');

    if (next.includes(pendingUrl)) {
      next = next
        .replace(markdownPattern, decorated)
        .replace(bbcodePattern, decorated)
        .replace(plainPattern, url);
      return;
    }

    next = next ? `${next}\n${decorated}` : decorated;
  });

  return next;
}

const PendingImagesPanel: React.FC<{ onSend: () => void }> = React.memo(
  (props) => {
    const { message, setMessage } = useChatInputActionContext();
    const pending = usePendingImages();

    return (
      <div className="w-80 space-y-2">
        <div className="text-sm font-semibold">Pending images</div>
        {pending.length === 0 ? (
          <div className="text-xs text-gray-500">No pending images.</div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-auto">
            {pending.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded p-2"
              >
                <img
                  alt="pending"
                  className="w-16 h-16 object-cover rounded"
                  src={item.previewUrl}
                />
                <div className="flex-1 text-xs">
                  <div className="font-medium break-all">
                    {item.file.name || 'image'}
                  </div>
                  <div className="text-gray-500">
                    {formatBytes(item.file.size)}
                  </div>
                  {item.status === 'uploading' && (
                    <div className="text-blue-500">Uploading...</div>
                  )}
                  {item.status === 'error' && (
                    <div className="text-red-500">
                      Upload failed. Retry by sending again.
                    </div>
                  )}
                </div>
                <button
                  className="text-gray-500 hover:text-red-500"
                  onClick={() => {
                    removePendingImage(item.id);
                    const nextMessage = stripPendingMarkup(message, item.id);
                    setMessage(nextMessage);
                  }}
                  disabled={item.status === 'uploading'}
                >
                  <Icon icon="mdi:close" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <Button
            size="small"
            onClick={props.onSend}
            disabled={!pending.length}
          >
            Send
          </Button>
        </div>
      </div>
    );
  }
);
PendingImagesPanel.displayName = 'PendingImagesPanel';

const MarkdownPasteController: React.FC = React.memo(() => {
  const { message, setMessage, sendMsg } = useChatInputActionContext();
  const pending = usePendingImages();
  const stateRef = useRef({ message, setMessage, sendMsg });
  const pendingRef = useRef(pending);
  const sendingRef = useRef(false);

  useEffect(() => {
    stateRef.current = { message, setMessage, sendMsg };
  }, [message, setMessage, sendMsg]);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const sendPendingImages = async () => {
    if (sendingRef.current) return;
    const snapshot = pendingRef.current;
    if (snapshot.length === 0) return;

    sendingRef.current = true;
    try {
      const uploads: Array<{
        id: string;
        url: string;
        width: number;
        height: number;
      }> = [];

      for (const item of snapshot) {
        const uploaded = await uploadPendingImage(item);
        uploads.push(uploaded);
      }

      const currentMessage = stateRef.current.message;
      const content = replacePendingMarkup(currentMessage, uploads);

      if (content.trim().length === 0) {
        notification.warning({
          message: 'Message is empty',
          description: 'Cannot send empty message.',
        });
        return;
      }

      await stateRef.current.sendMsg(content);
      stateRef.current.setMessage('');
      clearPendingImages();
    } catch (err) {
      notification.error({
        message: 'Failed to upload images',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      sendingRef.current = false;
    }
  };

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (!isChatInputTarget(event.target)) return;
      const files = getImageFilesFromClipboard(event.clipboardData);
      if (files.length === 0) return;

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }

      const { message: currentMessage, setMessage: setCurrentMessage } =
        stateRef.current;
      enqueuePendingImages(files, currentMessage, setCurrentMessage);
    };

    document.addEventListener('paste', handlePaste, true);
    return () => document.removeEventListener('paste', handlePaste, true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (pendingRef.current.length === 0) return;
      if (!isChatInputTarget(document.activeElement)) return;

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }

      void sendPendingImages();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (pendingRef.current.length === 0) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const sendIcon = target.closest('[data-icon="mdi:send-circle-outline"]');
      if (!sendIcon) return;

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }

      void sendPendingImages();
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  return (
    <BaseChatInputButton
      icon="mdi:image-multiple"
      popoverContent={() => <PendingImagesPanel onSend={sendPendingImages} />}
    />
  );
});
MarkdownPasteController.displayName = 'MarkdownPasteController';

regChatInputPasteHandler({
  name: `${PLUGIN_ID}/paste-image`,
  label: 'Paste image (pending)',
  match: (event) => {
    const files = getImageFilesFromClipboard(event.clipboardData);
    return files.length > 0;
  },
  handler: (data, ctx) => {
    const files = Array.from(data.files ?? []).filter((file) =>
      file.type.startsWith('image/')
    );
    if (files.length === 0) return;
    enqueuePendingImages(files, '', ctx.applyMessage);
  },
});

regChatInputButton({
  render: () => <MarkdownPasteController />,
});
