export default async function handler(req, res) {
    // 1. Configuración CORS para InfinityFree
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({
            error: true,
            mensaje: 'Método no permitido'
        });
    }

    // 2. Recoger parámetros
    const { lat, lon, fecha, hora } = req.query;

    if (!lat || !lon || !fecha || !hora) {
        return res.status(400).json({
            error: true,
            mensaje: 'Faltan parámetros: lat, lon, fecha u hora'
        });
    }

    const latNum = Number(lat);
    const lonNum = Number(lon);

    if (
        !Number.isFinite(latNum) ||
        !Number.isFinite(lonNum) ||
        latNum < -90 || latNum > 90 ||
        lonNum < -180 || lonNum > 180 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
        !/^\d{2}:\d{2}$/.test(hora)
    ) {
        return res.status(400).json({
            error: true,
            mensaje: 'Los parámetros geográficos o temporales no son válidos'
        });
    }

    const [year, month, day] = fecha.split('-').map(Number);
    const [hour, minute] = hora.split(':').map(Number);
    const dateCheck = new Date(Date.UTC(year, month - 1, day));

    if (
        dateCheck.getUTCFullYear() !== year ||
        dateCheck.getUTCMonth() !== month - 1 ||
        dateCheck.getUTCDate() !== day ||
        hour > 23 || minute > 59
    ) {
        return res.status(400).json({
            error: true,
            mensaje: 'La fecha u hora no existen'
        });
    }

    // Open-Meteo ofrece datos horarios, no registros cada minuto.
    // Para las 17:09 consultamos el registro de las 17:00.
    const targetTimestamp =
        `${fecha}T${String(hour).padStart(2, '0')}:00`;

    const resultado = {
        error: false,
        municipio: 'Desconocido',
        provincia: 'España',
        temp: null,
        hum: null,
        wind: null,
        wbgt: null,
        hora_consultada: targetTimestamp,
        hora_solicitada: hora,
        fuente: 'Open-Meteo Historical Weather API'
    };

    try {
        // 3. Geolocalización inversa mediante OpenStreetMap
        const urlGeo =
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
            `&lat=${latNum}&lon=${lonNum}&accept-language=es`;

        const geoRes = await fetch(urlGeo, {
            headers: {
                'User-Agent': 'RunningLab-Clima/1.0'
            }
        });

        if (geoRes.ok) {
            const geoData = await geoRes.json();
            const address = geoData.address || {};

            resultado.municipio =
                address.town ||
                address.village ||
                address.city ||
                address.municipality ||
                address.hamlet ||
                'Zona rural';

            resultado.provincia =
                address.province ||
                address.state ||
                'España';
        }

        // 4. Consulta meteorológica histórica
        const urlClima =
            `https://archive-api.open-meteo.com/v1/archive` +
            `?latitude=${latNum}` +
            `&longitude=${lonNum}` +
            `&start_date=${fecha}` +
            `&end_date=${fecha}` +
            `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m` +
            `&timezone=Europe%2FMadrid`;

        const climaRes = await fetch(urlClima);

        if (!climaRes.ok) {
            throw new Error(
                `Error de Open-Meteo: HTTP ${climaRes.status}`
            );
        }

        const data = await climaRes.json();

        if (!data.hourly || !data.hourly.time) {
            throw new Error('No se recibieron datos horarios');
        }

        const idx = data.hourly.time.indexOf(targetTimestamp);

        if (idx === -1) {
            throw new Error(
                `No existe el registro horario ${targetTimestamp}`
            );
        }

        // 5. Recuperar datos reales
        resultado.temp = data.hourly.temperature_2m[idx];
        resultado.hum = data.hourly.relative_humidity_2m[idx];
        resultado.wind = data.hourly.wind_speed_10m[idx];

        // 6. WBGT
        // No se calcula un WBGT real con estas tres variables.
        // Se deja null para evitar presentar una estimación como medición.
        resultado.wbgt = null;

        return res.status(200).json(resultado);

    } catch (err) {
        return res.status(500).json({
            error: true,
            mensaje: `Error de conexión: ${err.message}`
        });
    }
}

