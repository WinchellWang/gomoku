let engine = null;
let ready = false;
let queued = null;

const engineBase = "./engine/";
const engineName = "rapfi-single";
const thinkTimeMs = 4500;
const userAgent = self.navigator ? self.navigator.userAgent : "";
const isAppleWebKit = /AppleWebKit/i.test(userAgent) && !/(Chrome|Chromium|Edg|OPR)\//i.test(userAgent);

function locateFile(name) {
  if (/^rapfi.*\.data$/.test(name)) name = "rapfi.data";
  return new URL(engineBase + name, self.location.href).href;
}

function send(command) {
  engine.sendCommand(command);
}

function think({ moves }) {
  if (!ready) {
    queued = { moves };
    return;
  }

  send("INFO RULE 0");
  send("INFO THREAD_NUM 1");
  send("INFO STRENGTH 100");
  send("INFO TIMEOUT_TURN " + thinkTimeMs);
  send("INFO TIMEOUT_MATCH 600000");
  send("INFO MAX_DEPTH 100");
  send("INFO MAX_NODE 0");
  send("INFO SHOW_DETAIL 0");
  send("INFO PONDERING 0");
  send("INFO HASH_SIZE 32768");
  send("START 15");

  let command = "BOARD";
  for (let turn = 0; turn < moves.length; turn++) {
    const index = moves[turn];
    command += " " + (index % 15) + "," + Math.floor(index / 15) + "," + (turn % 2 + 1);
  }
  send(command + " DONE");
}

self.onmessage = ({ data }) => {
  if (data.type === "think") think(data);
};

try {
  const engineScript = engineBase + engineName + ".js?v=20260822-1";

  importScripts(engineScript);
  const options = {
    locateFile,
    setStatus(status) {
      const match = String(status).match(/\((\d+)\/(\d+)\)/);
      if (match) {
        self.postMessage({ type: "loading-progress", loaded: Number(match[1]), total: Number(match[2]) });
      }
    },
    onAbort(reason) {
      self.postMessage({ type: "engine-error", message: String(reason) });
    },
    onReceiveStdout(output) {
      const match = String(output).trim().match(/^(\d+),(\d+)$/);
      if (!match) return;
      self.postMessage({ type: "move", index: Number(match[2]) * 15 + Number(match[1]) });
    },
    onReceiveStderr(output) {
      console.warn("[Rapfi]", output);
    },
    onExit(code) {
      if (code) self.postMessage({ type: "engine-error", message: "Rapfi exited with code " + code });
    },
  };

  if (isAppleWebKit) {
    options.instantiateWasm = (imports, receiveInstance) => {
      fetch(locateFile(engineName + ".wasm"), { credentials: "same-origin" })
        .then((response) => {
          if (!response.ok) throw new Error("Unable to load Rapfi WASM (" + response.status + ")");
          return response.arrayBuffer();
        })
        .then((bytes) => WebAssembly.instantiate(bytes, imports))
        .then(({ instance, module }) => receiveInstance(instance, module))
        .catch((error) => self.postMessage({ type: "engine-error", message: String(error) }));
      return {};
    };
  }

  self.Rapfi(options).then((instance) => {
    engine = instance;
    ready = true;
    self.postMessage({ type: "ready" });
    if (queued) {
      const request = queued;
      queued = null;
      think(request);
    }
  }).catch((error) => self.postMessage({ type: "engine-error", message: String(error) }));
} catch (error) {
  self.postMessage({ type: "engine-error", message: String(error) });
}
