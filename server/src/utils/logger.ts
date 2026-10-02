export const logger = {
  info: (messageOrMeta: unknown, message?: string) => {
    if (message) {
      console.info(message, messageOrMeta);
      return;
    }
    console.info(messageOrMeta);
  },
  warn: (messageOrMeta: unknown, message?: string) => {
    if (message) {
      console.warn(message, messageOrMeta);
      return;
    }
    console.warn(messageOrMeta);
  },
  error: (messageOrMeta: unknown, message?: string) => {
    if (message) {
      console.error(message, messageOrMeta);
      return;
    }
    console.error(messageOrMeta);
  },
};
