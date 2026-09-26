// Hands raw microphone frames to the page for live voice (runs off the main thread, so capture never stutters).
// Served as a normal file: the app's security policy only allows scripts from its own origin.
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("mc-tap", Tap);
