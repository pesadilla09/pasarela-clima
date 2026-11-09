
/*
 * RUNNINGLAB - API METEOROLÓGICA HISTÓRICA
 * Ruta: /api/clima
 *
 * Devuelve:
 * - Temperatura
 * - Humedad relativa
 * - Viento
 * - Radiación solar
 * - WBGT estimado
 * - Municipio y provincia
 *
 * El WBGT se estima mediante una aproximación basada
 * en temperatura, humedad, viento y radiación solar.
 */

export default async function handler(req, res) {

    // Permitir peticiones desde RunningLab
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

        // ------------------------------------------------
        // CONSULTA A OPEN-METEO
        // ------------------------------------------------

        const base =
            'https://archive-api.open-meteo.com/v1/archive';

        const params = new URLSearchParams({
            latitude: String(lat),
            longitude: String(lon),
            start_date: fecha,
            end_date: fecha,

            hourly:
                'temperature_2m,' +
                'relative_humidity_2m,' +
                'wind_speed_10m,' +
                'shortwave_radiation',

            timezone: 'Europe/Madrid',
            wind_speed_unit: 'ms'
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
                'No hay datos meteorológicos para esa fecha'
            );
        }

        // ------------------------------------------------
        // BUSCAR LA HORA MÁS CERCANA AL ENTRENAMIENTO
        // ------------------------------------------------

        const objetivo = hh * 60 + mm;

        let indice = 0;
        let menorDiferencia = Infinity;

        meteo.hourly.time.forEach((valor, i) => {

            const partes = valor
                .slice(11, 16)
                .split(':')
                .map(Number);

            const minutos =
                partes[0] * 60 + partes[1];

            const diferencia =
                Math.abs(minutos - objetivo);

            if (diferencia < menorDiferencia) {
                menorDiferencia = diferencia;
                indice = i;
            }
        });

        const temp =
            meteo.hourly.temperature_2m[indice];

        const hum =
            meteo.hourly.relative_humidity_2m[indice];

        const wind =
            meteo.hourly.wind_speed_10m[indice];

        const radiation =
            meteo.hourly.shortwave_radiation[indice];

        // ------------------------------------------------
        // CÁLCULO WBGT ESTIMADO
        // ------------------------------------------------

        /*
         * IMPORTANTE:
         * Esta fórmula es una aproximación empírica.
         * NO es una implementación validada del método
         * físico WBGT de Liljegren et al. (2008).
         *
         * Para un WBGT fiable en condiciones exteriores
         * se necesita estimar temperatura de globo negro
         * y temperatura de bulbo húmedo natural mediante
         * un modelo físico.
         */

        function calcularWbgtEstimado(
            temperatura,
            humedad,
            viento,
            radiacion
        ) {

            if (
                temperatura === null ||
                humedad === null ||
                viento === null ||
                radiacion === null ||
                !Number.isFinite(Number(temperatura)) ||
                !Number.isFinite(Number(humedad)) ||
                !Number.isFinite(Number(viento)) ||
                !Number.isFinite(Number(radiacion))
            ) {
                return null;
            }

            const T = Number(temperatura);
            const RH = Number(humedad);
            const V = Number(viento);
            const R = Number(radiacion);

            if (
                RH < 0 || RH > 100 ||
                V < 0 ||
                R < 0
            ) {
                return null;
            }

            // Presión de vapor real aproximada (hPa)
            const es =
                6.105 * Math.exp(
                    (17.27 * T) / (237.7 + T)
                );

            const ea = (RH / 100) * es;

            // Temperatura de bulbo húmedo aproximada
            const Tw =
                T * Math.atan(
                    0.151977 * Math.sqrt(RH + 8.313659)
                ) +
                Math.atan(T + RH) -
                Math.atan(RH - 1.676331) +
                0.00391838 *
                Math.pow(RH, 1.5) *
                Math.atan(0.023101 * RH) -
                4.686035;

            // Incremento solar simplificado
            const incrementoSolar =
                0.017 * Math.sqrt(R) /
                (1 + 0.15 * V);

            const Tg = T + incrementoSolar;

            // WBGT exterior aproximado
            const wbgt =
                0.7 * Tw +
                0.2 * Tg +
                0.1 * T;

            return Number(wbgt.toFixed(1));
        }

        const wbgt = calcularWbgtEstimado(
            temp,
            hum,
            wind,
            radiation
        );

        // ------------------------------------------------
        // GEOCODIFICACIÓN: MUNICIPIO Y PROVINCIA
        // ------------------------------------------------

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
            // mantenemos los datos meteorológicos.
        }

        // ------------------------------------------------
        // RESPUESTA PARA RUNNINGLAB
        // ------------------------------------------------

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

            radiation: radiation !== null &&
                radiation !== undefined
                ? Number(radiation)
                : null,

            wbgt: wbgt,

            wbgt_tipo: 'Estimación aproximada exterior',

            hora_consultada:
                meteo.hourly.time[indice],

            hora_solicitada: hora,

            fuente:
                'Open-Meteo Historical Weather API'

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
