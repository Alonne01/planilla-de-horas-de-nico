/**
 * Fondo decorativo: "blobs" de color muy tenues que derivan lento, para dar profundidad sin distraer.
 * Port de la PWA, pero TEMATIZADO: usa los tokens `primary`/`accent` del tema activo, así se ve
 * correcto en los 6 temas (claros y oscuros). Se monta como capa con z NEGATIVO dentro de un
 * contenedor `relative isolate`. Reutiliza los keyframes blob-drift-* del index.css.
 */
export default function BgBlobs() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-16 top-8 h-64 w-64 rounded-full bg-primary/10 blur-3xl animate-[blob-drift-a_19s_ease-in-out_infinite]" />
      <div className="absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-accent/10 blur-3xl animate-[blob-drift-b_23s_ease-in-out_infinite]" />
      <div className="absolute bottom-4 left-1/4 h-64 w-64 rounded-full bg-primary/[0.06] blur-3xl animate-[blob-drift-c_21s_ease-in-out_infinite]" />
    </div>
  );
}
