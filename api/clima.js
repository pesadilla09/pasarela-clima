
/*
 * RUNNINGLAB - API METEOROLÓGICA HISTÓRICA
 * Ruta: /api/clima
 * Parámetros:
 *   lat: latitud GPS
 *   lon: longitud GPS
 *   fecha: YYYY-MM-DD
 *   hora: HH:mm
 */

export default async function handler(req, res) {
    // Permitir peticiones desde RunningLab (InfinityFree)
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

    try {
        const lat = Number(req.query.lat);
        const lon = Number(req.query.lon);
        const fecha = String(req.query.fecha || '');
        const hora = String(req.query.hora || '12:00');

        // Validación de coordenadas
        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            lat < -90 || lat > 90 ||
            lon < -180 || lon > 180
        ) {
            return res.status(400).json({
                error: true,
                mensaje: 'Coordenadas GPS no válidas'
            });
        }

        // Validación de fecha y hora
        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
            !/^\d{2}:\d{2}$/.test(hora)
        ) {
            return res.status(400).json({
                error: true,
                mensaje: 'Fecha u hora no válidas'
            });
        }

        const fechaObj = new Date(fecha + 'T12:00:00Z');

        if (
            Number.isNaN(fechaObj.getTime()) ||
            fechaObj.toISOString().slice(0, 10) !== fecha
        ) {
            return res.status(400).json({
                error: true,
                mensaje: 'La fecha indicada no existe'
            });
        }

        const [hh, mm] = hora.split(':').map(Number);

        if (hh > 23 || mm > 59) {
            return res.status(400).json({
                error: true,
                mensaje: 'La hora indicada no es válida'
            });
        }

        // Consulta a Open-Meteo Historical Weather API
        const base = 'https://archive-api.open-meteo.com/v1/archive';

        const params = new URLSearchParams({
            latitude: String(lat),
            longitude: String(lon),
            start_date: fecha,
            end_date: fecha,
            hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m',
            timezone: 'Europe/Madrid',
            wind_speed_unit: 'kmh'
        });

        const meteoResponse = await fetch(
            base + '?' + params.toString()
        );

        if (!meteoResponse.ok) {
            throw new Error(
                'Open-Meteo ha respondido con HTTP ' +
                meteoResponse.status
            );
        }

        const meteo = await meteoResponse.json();

        if (
            !meteo.hourly ||
            !Array.isArray(meteo.hourly.time) ||
            meteo.hourly.time.length === 0
        ) {
            throw new Error(
                'No hay datos meteorológicos históricos para esa fecha y ubicación'
            );
        }

        // Buscar la hora horaria más cercana a la del entrenamiento
        const objetivo = hh * 60 + mm;

        let indice = 0;
        let menorDiferencia = Infinity;

        meteo.hourly.time.forEach((valor, i) => {
            const partes = valor
                .slice(11, 16)
                .split(':')
                .map(Number);

            const minutos = partes[0] * 60 + partes[1];
            const diferencia = Math.abs(minutos - objetivo);

            if (diferencia < menorDiferencia) {
                menorDiferencia = diferencia;
                indice = i;
            }
        });

        const temp = meteo.hourly.temperature_2m[indice];
        const hum = meteo.hourly.relative_humidity_2m[indice];
        const wind = meteo.hourly.wind_speed_10m[indice];

        // Geocodificación inversa: municipio y provincia
        let municipio = 'Ubicación GPS';
        let provincia = '';

        try {
            const geoUrl =
                'https://nominatim.openstreetmap.org/reverse?' +
                new URLSearchParams({
                    format: 'jsonv2',
                    lat: String(lat),
                    lon: String(lon),
                    zoom: '10',
                    addressdetails: '1'
                }).toString();

            const geoResponse = await fetch(geoUrl, {
                headers: {
                    'User-Agent': 'RunningLab/1.0'
                }
            });

            if (geoResponse.ok) {
                const geo = await geoResponse.json();
                const address = geo.address || {};

                municipio =
                    address.city ||
                    address.town ||
                    address.village ||
                    address.municipality ||
                    address.hamlet ||
                    address.county ||
                    municipio;

                provincia =
                    address.state ||
                    address.province ||
                    address.region ||
                    '';
            }
        } catch (geoError) {
            // Si falla la geocodificación,
            // conservamos los datos meteorológicos.
        }

        // Respuesta JSON para RunningLab
        return res.status(200).json({
            error: false,

            municipio: municipio,
            provincia: provincia,

            temp: temp !== null && temp !== undefined
                ? Number(Number(temp).toFixed(1))
                : null,

            hum: hum !== null && hum !== undefined
                ? Number(hum)
                : null,

            wind: wind !== null && wind !== undefined
                ? Number(Number(wind).toFixed(1))
                : null,

            // No se calcula WBGT real en esta versión
            wbgt: null,

            hora_consultada: meteo.hourly.time[indice],
            hora_solicitada: hora,

            fuente: 'Open-Meteo Historical Weather API'
        });

    } catch (error) {
        console.error('Error API clima:', error);

        return res.status(500).json({
            error: true,
            mensaje: error.message ||
                'Error consultando el clima histórico'
        });
    }
}

