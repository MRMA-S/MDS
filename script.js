// WebSocket URL (يتم تحديثه بناءً على عنوان IP للـ ESP32)
const wsUrl = 'ws://192.168.4.1:81'; // عنوان خادم WebSocket على الـ ESP32
let socket;

// نطاقات القياسات الطبيعية والحالات
const measurementRanges = {
    temperature: {
        min: 36.1,
        max: 37.2,
        criticalLow: 35,
        criticalHigh: 38,
        format: value => value.toFixed(2), // تنسيق بمنزلتين عشريتين
        getStatus: value => {
            if (value < 35 || value > 38) return 'Critical';
            if (value < 36.1) return 'Low';
            if (value > 37.2) return 'High';
            return 'Normal';
        }
    },
    heartRate: {
        min: 60,
        max: 100,
        criticalLow: 40,
        criticalHigh: 120,
        format: value => Math.round(value), // أرقام صحيحة
        getStatus: value => {
            if (value < 40 || value > 120) return 'Critical';
            if (value < 60) return 'Low';
            if (value > 100) return 'High';
            return 'Normal';
        }
    },
    hrv: {
        min: 20,
        max: 70,
        format: value => Math.round(value), // أرقام صحيحة
        getStatus: value => {
            if (value < 20) return 'Low';
            if (value > 70) return 'High';
            return 'Normal';
        }
    },
    spo2: {
        min: 95,
        max: 100,
        criticalLow: 90,
        format: value => value.toFixed(2), // تنسيق بمنزلتين عشريتين
        getStatus: value => {
            if (value < 90) return 'Critical';
            if (value < 95) return 'Low';
            return 'Normal';
        }
    },
    conductance: {
        min: 2.0,
        max: 10.0,
        criticalLow: 0.0,
        criticalHigh: 50.0,
        format: value => value.toFixed(2), // تنسيق بمنزلتين عشريتين
        getStatus: value => {
            if (value < 0.0 || value > 50.0) return 'Critical';
            if (value <= 2.0) return 'Low';
            if (value > 10.0) return 'High';
            return 'Normal';
        }
    }
};

// نطاقات مستويات التوتر والأيقونات المقابلة
const stressRanges = {
    low: { max: 30, text: 'Relaxed', emoji: 'calm.png' },
    normal: { min: 31, max: 70, text: 'Stable', emoji: 'neutral.png' },
    high: { min: 71, max: 100, text: 'Stressed', emoji: 'frustrated.png' }
};

// دالة حساب التوتر باستخدام المتوسط المرجح (Weighted Average)
function calculateStress(data) {
    // النطاقات لكل مؤشر (min, max)
    const minMax = {
        temperature: [30, 37], // منخفض = توتر
        conductance: [0, 10], // عالي = توتر
        heartRate: [50, 120], // عالي = توتر
        hrv: [0, 80], // منخفض = توتر (معكوس)
        spo2: [90, 100] // منخفض = توتر (معكوس)
    };

    // الأوزان (مجموع = 1)
    const weights = {
        temperature: 0.05,
        conductance: 0.4,
        heartRate: 0.15,
        hrv: 0.3,
        spo2: 0.1
    };

    let activeCount = 0;
    let totalStress = 0;

    // حساب الدرجة لكل مؤشر إذا كان > 0
    if (data.temperature > 0) {
        const normTemp = 1 - ((data.temperature - minMax.temperature[0]) / (minMax.temperature[1] - minMax.temperature[0])); // منخفض = توتر
        totalStress += normTemp * weights.temperature;
        activeCount++;
    }

    if (data.conductance > 0) {
        const normConductance = (data.conductance - minMax.conductance[0]) / (minMax.conductance[1] - minMax.conductance[0]); // عالي = توتر
        totalStress += normConductance * weights.conductance;
        activeCount++;
    }

    if (data.heartRate > 0) {
        const normHeartRate = (data.heartRate - minMax.heartRate[0]) / (minMax.heartRate[1] - minMax.heartRate[0]); // عالي = توتر
        totalStress += normHeartRate * weights.heartRate;
        activeCount++;
    }

    if (data.hrv > 0) {
        const normHrv = 1 - ((data.hrv - minMax.hrv[0]) / (minMax.hrv[1] - minMax.hrv[0])); // منخفض = توتر
        totalStress += normHrv * weights.hrv;
        activeCount++;
    }

    if (data.spo2 > 0) {
        const normSpo2 = 1 - ((data.spo2 - minMax.spo2[0]) / (minMax.spo2[1] - minMax.spo2[0])); // منخفض = توتر
        totalStress += normSpo2 * weights.spo2;
        activeCount++;
    }

    if (activeCount === 0) return 0; // إذا كانت جميع القيم 0, التوتر 0

    // حساب المتوسط المرجح مع تعديل لعدد المؤشرات الفعالة
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    const adjustedStress = (totalStress / totalWeight) * 100; // تحويل إلى نسبة مئوية

    return adjustedStress;
}

// دالة إنشاء اتصال WebSocket
function initWebSocket() {
    socket = new WebSocket(wsUrl);

    // عند فتح الاتصال
    socket.onopen = () => {
        console.log('WebSocket connected');
    };

    // عند استقبال رسالة
    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('Received WebSocket data:', data);
            updateMeasurements(data);
            const stressValue = calculateStress(data);
            updateMoodResult(stressValue);
        } catch (error) {
            console.error('Error parsing WebSocket data:', error);
        }
    };

    // عند إغلاق الاتصال
    socket.onclose = () => {
        console.log('WebSocket disconnected. Reconnecting in 5 seconds...');
        setTimeout(initWebSocket, 5000); // إعادة المحاولة بعد 5 ثوانٍ
    };

    // عند حدوث خطأ
    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// دالة تحديث القياسات (القيمة العددية والمستوى)
function updateMeasurements(data) {
    // قائمة القياسات ومعرفاتها
    const measurements = [
        { key: 'temperature', valueId: 'Temperature-value', levelId: 'Temperature-level' },
        { key: 'heartRate', valueId: 'hr-value', levelId: 'hr-level' },
        { key: 'hrv', valueId: 'hrv-value', levelId: 'hrv-level' },
        { key: 'spo2', valueId: 'spo2-value', levelId: 'spo2-level' },
        { key: 'conductance', valueId: 'conductance-value', levelId: 'conductance-level' }
    ];

    measurements.forEach(({ key, valueId, levelId }) => {
        if (data[key] !== undefined) {
            const value = data[key];
            const config = measurementRanges[key];

            // تحديث القيمة العددية (Text Node)
            const valueElement = document.getElementById(valueId);
            if (valueElement && valueElement.childNodes[0]) {
                valueElement.childNodes[0].textContent = config.format(value);
            } else {
                console.warn(`Value element or text node not found for ${valueId}`);
            }

            // تحديث المستوى
            const levelElement = document.getElementById(levelId);
            if (levelElement) {
                levelElement.textContent = config.getStatus(value);
            } else {
                console.warn(`Level element not found for ${levelId}`);
            }
        }
    });
}

// دالة تحديث نتيجة التوتر
function updateMoodResult(stressValue) {
    const moodValueElement = document.getElementById('mood-value');
    const moodEmojiElement = document.getElementById('mood-emoji');

    if (!moodValueElement || !moodEmojiElement) {
        console.warn('Mood value or emoji element not found');
        return;
    }

    let moodStatus;
    if (stressValue <= stressRanges.low.max) {
        moodStatus = stressRanges.low;
    } else if (stressValue <= stressRanges.normal.max) {
        moodStatus = stressRanges.normal;
    } else {
        moodStatus = stressRanges.high;
    }

    // تحديث النص
    moodValueElement.textContent = moodStatus.text;

    // تحديث الأيقونة
    moodEmojiElement.src = `/Indicators/${moodStatus.emoji}`;
    moodEmojiElement.alt = moodStatus.text;
}

// تهيئة WebSocket عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
});