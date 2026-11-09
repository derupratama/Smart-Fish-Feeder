#include <OneWire.h>
#include <DallasTemperature.h>
#include <DHT.h>
#include <ESP32Servo.h>
#include <WiFi.h>
#include <ArduinoMqttClient.h>
#include <ctype.h>
#include <string.h>
#include "secrets.h"

#define ONE_WIRE_BUS 4
#define DHT_PIN 25
#define DHT_TYPE DHT22
#define TRIG_PAKAN 26
#define ECHO_PAKAN 18
#define TRIG_AIR 19
#define ECHO_AIR 21
#define SERVO_PIN 23

const char *TOPIC_SUHU_AIR = "smartfish/telemetry/suhu_air";
const char *TOPIC_SUHU_WADAH = "smartfish/telemetry/suhu_wadah";
const char *TOPIC_KELEMBAPAN = "smartfish/telemetry/kelembapan";
const char *TOPIC_JARAK_PAKAN = "smartfish/telemetry/jarak_pakan";
const char *TOPIC_JARAK_AIR = "smartfish/telemetry/jarak_air";
const char *TOPIC_STATUS_SERVO = "smartfish/status/servo";
const char *TOPIC_STATUS_DEVICE = "smartfish/status/device";
const char *TOPIC_COMMAND_SERVO = "smartfish/command/servo";

constexpr unsigned long SENSOR_INTERVAL_MS = 1000;
constexpr unsigned long TELEMETRY_INTERVAL_MS = 10000;
constexpr unsigned long WIFI_RETRY_INTERVAL_MS = 5000;
constexpr unsigned long MQTT_RETRY_INTERVAL_MS = 5000;

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensorSuhu(&oneWire);
DHT dht(DHT_PIN, DHT_TYPE);
Servo servoPakan;

WiFiClient wifiClient;
MqttClient mqttClient(wifiClient);

const int SERVO_TUTUP = 0;
const int SERVO_BUKA = 90;
bool statusServo = false;
bool statusServoPerluDikirim = true;

float suhuAir = DEVICE_DISCONNECTED_C;
float suhuWadah = NAN;
float kelembapan = NAN;
float jarakPakan = -1;
float jarakAir = -1;
bool suhuAirValid = false;
bool dhtValid = false;
bool jarakPakanValid = false;
bool jarakAirValid = false;

bool konversiSuhuAktif = false;
unsigned long waktuPermintaanSuhu = 0;
uint16_t waktuKonversiSuhu = 0;
unsigned long waktuSensorTerakhir = 0;
unsigned long waktuTelemetryTerakhir = 0;
unsigned long waktuCobaWifi = 0;
unsigned long waktuCobaMqtt = 0;
bool wifiDimulai = false;
bool konfigurasiDilaporkan = false;

enum PerintahServo { TIDAK_ADA_PERINTAH, PERINTAH_BUKA, PERINTAH_TUTUP };
volatile PerintahServo perintahMqttTertunda = TIDAK_ADA_PERINTAH;

char bufferSerial[32];
size_t panjangBufferSerial = 0;
bool bufferSerialPenuh = false;

float bacaJarak(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(3);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long durasi = pulseIn(echoPin, HIGH, 30000);

  if (durasi == 0) return -1;

  return durasi * 0.0343 / 2;
}

void bukaPakan() {
  if (!statusServo) {
    servoPakan.write(SERVO_BUKA);
    statusServo = true;
    statusServoPerluDikirim = true;
    Serial.println("SERVO: ON");
    Serial.println("Tempat pakan dibuka");
  }
}

void tutupPakan() {
  if (statusServo) {
    servoPakan.write(SERVO_TUTUP);
    statusServo = false;
    statusServoPerluDikirim = true;
    Serial.println("SERVO: OFF");
    Serial.println("Tempat pakan ditutup");
  }
}

bool konfigurasiKoneksiTersedia() {
  return strlen(WIFI_SSID) > 0 && strlen(WIFI_PASSWORD) > 0 &&
         strlen(MQTT_HOST) > 0 && strlen(MQTT_USERNAME) > 0 &&
         strlen(MQTT_PASSWORD) > 0;
}

void mulaiKonversiSuhuAir(unsigned long now) {
  sensorSuhu.requestTemperatures();
  waktuPermintaanSuhu = now;
  waktuKonversiSuhu = sensorSuhu.millisToWaitForConversion();
  konversiSuhuAktif = true;
}

void periksaKonversiSuhuAir() {
  if (!konversiSuhuAktif || millis() - waktuPermintaanSuhu < waktuKonversiSuhu) return;

  suhuAir = sensorSuhu.getTempCByIndex(0);
  suhuAirValid = suhuAir != DEVICE_DISCONNECTED_C;
  konversiSuhuAktif = false;

  if (suhuAirValid) {
    Serial.print("Suhu Air: ");
    Serial.print(suhuAir);
    Serial.println(" C");
  } else {
    Serial.println("Suhu Air: Sensor tidak terdeteksi");
  }
}

void bacaSensorLainnya() {
  Serial.println();
  Serial.println("======= DATA SENSOR =======");

  kelembapan = dht.readHumidity();
  suhuWadah = dht.readTemperature();
  dhtValid = !isnan(kelembapan) && !isnan(suhuWadah);

  if (dhtValid) {
    Serial.print("Suhu Wadah Pakan: ");
    Serial.print(suhuWadah);
    Serial.println(" C");

    Serial.print("Kelembapan Pakan: ");
    Serial.print(kelembapan);
    Serial.println(" %");
  } else {
    Serial.println("DHT22: Gagal membaca sensor");
  }

  jarakPakan = bacaJarak(TRIG_PAKAN, ECHO_PAKAN);
  jarakPakanValid = jarakPakan >= 0;

  if (jarakPakanValid) {
    Serial.print("Jarak Sisa Pakan: ");
    Serial.print(jarakPakan);
    Serial.println(" cm");
  } else {
    Serial.println("Ultrasonic Pakan: Tidak terbaca");
  }

  // Jeda singkat mengurangi kemungkinan pantulan ultrasonik saling mengganggu.
  delay(60);

  jarakAir = bacaJarak(TRIG_AIR, ECHO_AIR);
  jarakAirValid = jarakAir >= 0;

  if (jarakAirValid) {
    Serial.print("Jarak Permukaan Air: ");
    Serial.print(jarakAir);
    Serial.println(" cm");
  } else {
    Serial.println("Ultrasonic Air: Tidak terbaca");
  }

  Serial.print("Status Servo: ");
  Serial.println(statusServo ? "ON (TERBUKA)" : "OFF (TERTUTUP)");
  Serial.println("===========================");
}

void prosesPerintahLokal(char *perintah) {
  char *awal = perintah;
  while (*awal && isspace(static_cast<unsigned char>(*awal))) awal++;

  char *akhir = awal + strlen(awal);
  while (akhir > awal && isspace(static_cast<unsigned char>(akhir[-1]))) akhir--;
  *akhir = '\0';

  for (char *p = awal; *p; ++p) {
    *p = static_cast<char>(toupper(static_cast<unsigned char>(*p)));
  }

  if (strcmp(awal, "ON") == 0) {
    bukaPakan();
  } else if (strcmp(awal, "OFF") == 0) {
    tutupPakan();
  } else if (*awal) {
    Serial.println("Perintah tidak dikenal!");
    Serial.println("Gunakan ON atau OFF");
  }
}

void bacaPerintahSerial() {
  while (Serial.available() > 0) {
    char c = static_cast<char>(Serial.read());
    if (c == '\r') continue;

    if (c == '\n') {
      if (bufferSerialPenuh) {
        Serial.println("Perintah tidak dikenal!");
        Serial.println("Gunakan ON atau OFF");
      } else {
        bufferSerial[panjangBufferSerial] = '\0';
        prosesPerintahLokal(bufferSerial);
      }
      panjangBufferSerial = 0;
      bufferSerialPenuh = false;
      continue;
    }

    if (panjangBufferSerial < sizeof(bufferSerial) - 1) {
      bufferSerial[panjangBufferSerial++] = c;
    } else {
      bufferSerialPenuh = true;
    }
  }
}

void onMqttMessage(int messageSize) {
  String topic = mqttClient.messageTopic();
  char payload[16];
  size_t panjangPayload = 0;

  while (mqttClient.available()) {
    int c = mqttClient.read();
    if (panjangPayload < sizeof(payload) - 1) {
      payload[panjangPayload++] = static_cast<char>(c);
    }
  }
  payload[panjangPayload] = '\0';

  if (topic != TOPIC_COMMAND_SERVO || messageSize >= static_cast<int>(sizeof(payload))) return;

  char *awal = payload;
  while (*awal && isspace(static_cast<unsigned char>(*awal))) awal++;
  char *akhir = awal + strlen(awal);
  while (akhir > awal && isspace(static_cast<unsigned char>(akhir[-1]))) akhir--;
  *akhir = '\0';
  for (char *p = awal; *p; ++p) {
    *p = static_cast<char>(toupper(static_cast<unsigned char>(*p)));
  }

  if (strcmp(awal, "ON") == 0) {
    perintahMqttTertunda = PERINTAH_BUKA;
  } else if (strcmp(awal, "OFF") == 0) {
    perintahMqttTertunda = PERINTAH_TUTUP;
  } else if (*awal) {
    Serial.println("Perintah MQTT tidak dikenal!");
    Serial.println("Gunakan ON atau OFF");
  }
}

bool kirimTeks(const char *topic, const char *payload, bool retained) {
  if (!mqttClient.connected()) return false;
  mqttClient.beginMessage(topic, retained, 0);
  mqttClient.print(payload);
  return mqttClient.endMessage() == 1;
}

bool kirimAngka(const char *topic, float nilai) {
  if (!mqttClient.connected()) return false;
  mqttClient.beginMessage(topic, false, 0);
  mqttClient.print(nilai, 2);
  return mqttClient.endMessage() == 1;
}

void kirimStatusServo() {
  if (!mqttClient.connected() || !statusServoPerluDikirim) return;
  if (kirimTeks(TOPIC_STATUS_SERVO, statusServo ? "ON" : "OFF", true)) {
    statusServoPerluDikirim = false;
  }
}

void kirimTelemetry() {
  if (!mqttClient.connected()) return;
  if (suhuAirValid) kirimAngka(TOPIC_SUHU_AIR, suhuAir);
  if (dhtValid) {
    kirimAngka(TOPIC_SUHU_WADAH, suhuWadah);
    kirimAngka(TOPIC_KELEMBAPAN, kelembapan);
  }
  if (jarakPakanValid) kirimAngka(TOPIC_JARAK_PAKAN, jarakPakan);
  if (jarakAirValid) kirimAngka(TOPIC_JARAK_AIR, jarakAir);
}

void cobaKoneksiWifi(unsigned long now) {
  if (!konfigurasiKoneksiTersedia()) {
    if (!konfigurasiDilaporkan) {
      Serial.println("Wi-Fi/MQTT belum dikonfigurasi. Isi nilai di secrets.h.");
      konfigurasiDilaporkan = true;
    }
    return;
  }

  if (!wifiDimulai) {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    wifiDimulai = true;
    waktuCobaWifi = now;
    Serial.println("Menghubungkan ke Wi-Fi...");
    return;
  }

  if (WiFi.status() != WL_CONNECTED && now - waktuCobaWifi >= WIFI_RETRY_INTERVAL_MS) {
    waktuCobaWifi = now;
    WiFi.reconnect();
    Serial.println("Mencoba menghubungkan ulang Wi-Fi...");
  }
}

void cobaKoneksiMqtt(unsigned long now) {
  if (WiFi.status() != WL_CONNECTED) {
    if (mqttClient.connected()) mqttClient.stop();
    return;
  }

  if (mqttClient.connected() || now - waktuCobaMqtt < MQTT_RETRY_INTERVAL_MS) return;
  waktuCobaMqtt = now;

  mqttClient.beginWill(TOPIC_STATUS_DEVICE, 7, true, 0);
  mqttClient.print("offline");
  mqttClient.endWill();

  Serial.println("Mencoba menghubungkan ke MQTT broker...");
  if (!mqttClient.connect(MQTT_HOST, MQTT_PORT)) {
    Serial.print("Koneksi MQTT gagal, kode: ");
    Serial.println(mqttClient.connectError());
    return;
  }

  if (!mqttClient.subscribe(TOPIC_COMMAND_SERVO, 1)) {
    Serial.println("Gagal subscribe ke topic perintah servo");
    mqttClient.stop();
    return;
  }

  kirimTeks(TOPIC_STATUS_DEVICE, "online", true);
  statusServoPerluDikirim = true;
  kirimStatusServo();
  Serial.println("MQTT terhubung; topic perintah servo aktif");
}

void prosesPerintahMqttTertunda() {
  PerintahServo perintah = perintahMqttTertunda;
  if (perintah == TIDAK_ADA_PERINTAH) return;
  perintahMqttTertunda = TIDAK_ADA_PERINTAH;

  if (perintah == PERINTAH_BUKA) bukaPakan();
  if (perintah == PERINTAH_TUTUP) tutupPakan();
}

void setup() {
  Serial.begin(115200);

  sensorSuhu.begin();
  sensorSuhu.setWaitForConversion(false);
  dht.begin();

  pinMode(TRIG_PAKAN, OUTPUT);
  pinMode(ECHO_PAKAN, INPUT);
  pinMode(TRIG_AIR, OUTPUT);
  pinMode(ECHO_AIR, INPUT);

  digitalWrite(TRIG_PAKAN, LOW);
  digitalWrite(TRIG_AIR, LOW);

  servoPakan.setPeriodHertz(50);
  servoPakan.attach(SERVO_PIN, 500, 2400);
  servoPakan.write(SERVO_TUTUP);
  statusServo = false;

  mqttClient.setId("smartfish-esp32");
  mqttClient.setUsernamePassword(MQTT_USERNAME, MQTT_PASSWORD);
  mqttClient.setKeepAliveInterval(15000);
  mqttClient.setConnectionTimeout(1500);
  mqttClient.onMessage(onMqttMessage);

  waktuSensorTerakhir = millis() - SENSOR_INTERVAL_MS;
  waktuTelemetryTerakhir = millis();

  Serial.println("==============================");
  Serial.println(" SMART FISH FEEDER ESP32");
  Serial.println("==============================");
  Serial.println("Sistem berhasil diinisialisasi");
  Serial.println("Ketik ON  = Buka pakan");
  Serial.println("Ketik OFF = Tutup pakan");
  Serial.println("==============================");
}

void loop() {
  unsigned long now = millis();

  cobaKoneksiWifi(now);
  cobaKoneksiMqtt(now);
  if (mqttClient.connected()) mqttClient.poll();

  prosesPerintahMqttTertunda();
  bacaPerintahSerial();

  now = millis();
  if (now - waktuSensorTerakhir >= SENSOR_INTERVAL_MS) {
    waktuSensorTerakhir = now;
    mulaiKonversiSuhuAir(now);
    bacaSensorLainnya();
  }

  periksaKonversiSuhuAir();
  if (mqttClient.connected()) mqttClient.poll();
  kirimStatusServo();

  now = millis();
  if (now - waktuTelemetryTerakhir >= TELEMETRY_INTERVAL_MS) {
    waktuTelemetryTerakhir = now;
    kirimTelemetry();
  }
}
