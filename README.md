# Radar NCAAB

Web de básquet colegial con datos de TeamRankings.com: partidos del día (con ◀ ▶ y calendario),
buscador por equipo o conferencia, filtro "Solo con datos", posición en la conferencia,
% de victorias y racha; puntos 1ª mitad, puntos por juego, triples, rebotes y asistencias
(local en casa / visita fuera; cancha neutral = temporada); 3 marcadores posibles, total,
hándicap (spread) y los 5 mejores jugadores de cada equipo (puntos, asistencias, rebotes).

## Estructura
- `public/index.html` — la página
- `netlify/functions/ncaab.mjs` — lee TeamRankings y entrega `/api/ncaab?date=AAAA-MM-DD`
  (las direcciones de TeamRankings están juntas al inicio del archivo, en CONFIGURACIÓN)
- `netlify.toml` — configuración de Netlify (no cambiar)

## Publicar
1. Crear repositorio nuevo en GitHub y subir arrastrando las carpetas `public` y `netlify`
   más los archivos `netlify.toml`, `package.json` y `README.md`. No hace falta main.yml.
2. Netlify → Add new site → Import from GitHub → elegir el repositorio → Deploy.
