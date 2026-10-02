try {
  require('./dist/server');
} catch (error) {
  console.error('The TypeScript server has not been built yet.');
  console.error('Run "npm run dev" for development or "npm run build && npm start" for production.');
  process.exit(1);
}
