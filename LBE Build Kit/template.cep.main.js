(function () {
  var status = document.getElementById("status");
  var button = document.getElementById("ping-host");

  function setStatus(message) {
    if (status) {
      status.textContent = message;
    }
  }

  function detectCSInterface() {
    return typeof window.CSInterface === "function";
  }

  if (button) {
    button.addEventListener("click", function () {
      if (detectCSInterface()) {
        setStatus("CSInterface detected. Wire your evalScript flow here.");
      } else {
        setStatus("Running outside CEP host. Browser mode only.");
      }
    });
  }
}());
