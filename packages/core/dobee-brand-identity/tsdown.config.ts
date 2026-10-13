export default {
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  unbundle: true,
  sourcemap: true,
  clean: false,
}
