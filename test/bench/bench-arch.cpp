/*
 * The native side of `test/bench/wasm-vs-cpp.mjs`: a Faust architecture
 * that times the C++ the Faust compiler generates, under the same protocol
 * as the wasm side, so that the two numbers can be divided.
 *
 *   program <sampleRate> <blockSize> <framesPerRun> <runs> <refFrames> <refFile>
 *
 * 1. init(sampleRate), every control left at its default: a program for the
 *    bench holds its gate as a slider at 1 rather than a button (see
 *    test/bench/dsp/README.md), since pressing every button would also tick
 *    the bypass checkboxes;
 * 2. <refFrames> frames rendered and written to <refFile>, channel after
 *    channel, as FAUSTFLOAT: the wasm side renders the same frames and
 *    compares, which is what proves both sides computed the same thing;
 * 3. one untimed run to warm the caches, then <runs> timed runs of
 *    <framesPerRun> frames, block by block.
 *
 * The inputs are the same deterministic noise on both sides (the LCG below,
 * mirrored in `noise` of wasm-vs-cpp.mjs), one block of it repeated.
 *
 * Prints one line of JSON: {"inputs":..,"outputs":..,"runs_ns":[...]}.
 */

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>
#ifdef __APPLE__
#include <pthread.h>
#include <sys/qos.h>
#endif

#include "faust/dsp/dsp.h"
#include "faust/gui/UI.h"
#include "faust/gui/meta.h"

<<includeIntrinsic>>

<<includeclass>>

// A sink the optimizer cannot see through, so the timed loop is not removed.
static volatile double gSink = 0.;

int main(int argc, char* argv[])
{
    if (argc != 7) {
        fprintf(stderr, "usage: %s sampleRate blockSize framesPerRun runs refFrames refFile\n", argv[0]);
        return 2;
    }
    const int sampleRate = atoi(argv[1]);
    const int blockSize = atoi(argv[2]);
    const long framesPerRun = atol(argv[3]);
    const int runs = atoi(argv[4]);
    const long refFrames = atol(argv[5]);
    const char* refFile = argv[6];

#ifdef __APPLE__
    // This process lives a fraction of a second, and macOS may keep it on an
    // efficiency core all along (a C++ time twice too long, seen on an M5).
    // The Node side is one long busy process, which the scheduler moves to a
    // performance core early. audio-dsl-bench pins its harness the same way.
    pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0);
#endif

    mydsp* DSP = new mydsp();
    DSP->init(sampleRate);

    const int numInputs = DSP->getNumInputs();
    const int numOutputs = DSP->getNumOutputs();

    std::vector<std::vector<FAUSTFLOAT>> inBuffers(numInputs, std::vector<FAUSTFLOAT>(blockSize));
    std::vector<std::vector<FAUSTFLOAT>> outBuffers(numOutputs, std::vector<FAUSTFLOAT>(blockSize));
    std::vector<FAUSTFLOAT*> inputs(numInputs + 1, nullptr);
    std::vector<FAUSTFLOAT*> outputs(numOutputs + 1, nullptr);

    uint32_t seed = 12345u;
    for (int chan = 0; chan < numInputs; chan++) {
        inputs[chan] = inBuffers[chan].data();
        for (int i = 0; i < blockSize; i++) {
            seed = seed * 1664525u + 1013904223u;
            inBuffers[chan][i] = FAUSTFLOAT((float(seed >> 8) / 16777216.f) * 0.5f - 0.25f);
        }
    }
    for (int chan = 0; chan < numOutputs; chan++) {
        outputs[chan] = outBuffers[chan].data();
    }

    // Reference frames
    std::vector<std::vector<FAUSTFLOAT>> ref(numOutputs, std::vector<FAUSTFLOAT>(refFrames));
    for (long done = 0; done < refFrames; done += blockSize) {
        const int count = int(std::min<long>(blockSize, refFrames - done));
        DSP->compute(count, inputs.data(), outputs.data());
        for (int chan = 0; chan < numOutputs; chan++) {
            for (int i = 0; i < count; i++) ref[chan][done + i] = outBuffers[chan][i];
        }
    }
    FILE* file = fopen(refFile, "wb");
    if (!file) {
        fprintf(stderr, "cannot write %s\n", refFile);
        return 1;
    }
    for (int chan = 0; chan < numOutputs; chan++) {
        fwrite(ref[chan].data(), sizeof(FAUSTFLOAT), refFrames, file);
    }
    fclose(file);

    // Timed runs, after one to warm up
    const long blocks = framesPerRun / blockSize;
    std::vector<long long> runsNs;
    for (int run = -1; run < runs; run++) {
        auto start = std::chrono::steady_clock::now();
        for (long b = 0; b < blocks; b++) {
            DSP->compute(blockSize, inputs.data(), outputs.data());
        }
        auto stop = std::chrono::steady_clock::now();
        if (numOutputs > 0) gSink = gSink + outBuffers[0][0];
        if (run >= 0) {
            runsNs.push_back(std::chrono::duration_cast<std::chrono::nanoseconds>(stop - start).count());
        }
    }

    printf("{\"inputs\":%d,\"outputs\":%d,\"runs_ns\":[", numInputs, numOutputs);
    for (size_t i = 0; i < runsNs.size(); i++) {
        printf("%s%lld", i ? "," : "", runsNs[i]);
    }
    printf("]}\n");

    delete DSP;
    return 0;
}
