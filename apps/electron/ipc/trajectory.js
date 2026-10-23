/* global module */
const { randomUUID } = require('node:crypto');

const subscriptions = new Map();

/** 注册轨迹增量订阅和取消订阅 IPC。 */
function registerTrajectoryHandlers({ ipcMain, services }) {
  ipcMain.handle('conversations:subscribeTrajectory', async (event, conversationId, afterSeq) => {
    const descriptor = services.endpointRegistry
      ?.getByResource('conversations')
      .find((item) => item.id === 'conversations:streamTrajectory');
    if (!descriptor) throw new Error('Conversation trajectory stream is unavailable');
    if (typeof conversationId !== 'string' || !conversationId.trim()) {
      throw new Error('conversationId is required');
    }

    const subscriptionId = randomUUID();
    const subscription = createSubscription(event.sender, subscriptionId);
    subscriptions.set(subscriptionId, subscription);
    event.sender.once('destroyed', subscription.close);
    try {
      descriptor.service(conversationId, { afterSeq }, createRequest(), subscription.response);
    } catch (error) {
      subscription.close();
      throw error;
    }
    return { subscriptionId };
  });

  ipcMain.handle('conversations:unsubscribeTrajectory', (event, subscriptionId) => {
    const subscription = subscriptions.get(subscriptionId);
    if (!subscription || subscription.senderId !== event.sender.id) {
      return { unsubscribed: false };
    }
    subscription.close();
    return { unsubscribed: true };
  });
}

/** 创建不触发 HTTP 的请求外观，向运行时 SSE 服务提供游标请求头。 */
function createRequest() {
  return { header: () => undefined };
}

/** 创建将 SSE 事件转发到指定 Electron sender 的响应外观。 */
function createSubscription(sender, subscriptionId) {
  const state = { closed: false, closeHandler: undefined };
  const close = () => {
    if (state.closed) return;
    state.closed = true;
    if (state.closeHandler) state.closeHandler();
    subscriptions.delete(subscriptionId);
    sender.removeListener('destroyed', close);
  };
  const response = {
    status() {
      return this;
    },
    setHeader() {},
    flushHeaders() {},
    write(chunk) {
      const message = parseEventStreamMessage(chunk);
      if (message) {
        const channel = message.error
          ? 'conversations:trajectoryError'
          : 'conversations:trajectoryUpdate';
        sender.send(channel, subscriptionId, message.error || message);
      }
      return true;
    },
    on(eventName, callback) {
      if (eventName === 'close') state.closeHandler = callback;
      return this;
    },
    end() {
      close();
    },
  };
  return { senderId: sender.id, response, close };
}

/** 解析单个 SSE 帧中的安全 JSON 数据。 */
function parseEventStreamMessage(chunk) {
  if (typeof chunk !== 'string') return undefined;
  const dataLine = chunk.split(/\r?\n/).find((line) => line.startsWith('data: '));
  if (!dataLine) return undefined;
  try {
    return JSON.parse(dataLine.slice(6));
  } catch {
    return undefined;
  }
}

module.exports = { registerTrajectoryHandlers };
