import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/background.ts", "src/content.ts", "src/panel.ts"],
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome110",
  sourcemap: true,
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching for changes...");
} else {
  await esbuild.build(options);
  console.log("build complete -> extension/dist/");
}
