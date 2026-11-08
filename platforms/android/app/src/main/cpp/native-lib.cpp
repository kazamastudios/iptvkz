// Ponte JNI: inicia o Node embutido e manda stdout/stderr para o logcat.
#include <android/log.h>
#include <jni.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "node.h"

static int pipeFds[2];

static void *logThread(void *) {
    char buf[1024];
    ssize_t n;
    while ((n = read(pipeFds[0], buf, sizeof(buf) - 1)) > 0) {
        buf[n] = 0;
        __android_log_write(ANDROID_LOG_INFO, "IPTVKZ-node", buf);
    }
    return nullptr;
}

static void redirectLogs() {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(pipeFds) != 0) return;
    dup2(pipeFds[1], STDOUT_FILENO);
    dup2(pipeFds[1], STDERR_FILENO);
    pthread_t t;
    if (pthread_create(&t, nullptr, logThread, nullptr) == 0) pthread_detach(t);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_lucasyemz_iptvkz_MainActivity_startNode(JNIEnv *env, jclass, jobjectArray args) {
    jsize argc = env->GetArrayLength(args);
    std::vector<std::string> values;
    size_t size = 0;
    for (jsize i = 0; i < argc; i++) {
        auto s = (jstring) env->GetObjectArrayElement(args, i);
        const char *c = env->GetStringUTFChars(s, nullptr);
        values.emplace_back(c);
        size += values.back().size() + 1;
        env->ReleaseStringUTFChars(s, c);
    }
    // O Node exige os argumentos em memória contígua.
    char *block = (char *) calloc(size, 1);
    std::vector<char *> argv;
    char *p = block;
    for (auto &v : values) {
        memcpy(p, v.c_str(), v.size() + 1);
        argv.push_back(p);
        p += v.size() + 1;
    }
    redirectLogs();
    return node::Start(argc, argv.data());
}
