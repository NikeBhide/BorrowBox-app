// Small progressive enhancements. The site works without this file.

// Auto-submit filter dropdowns.
document.querySelectorAll("select[data-autosubmit]").forEach(function (select) {
  select.addEventListener("change", function () {
    select.form.submit();
  });
});

// On the sign-up page, show which college and campus an email belongs to.
(function () {
  var email = document.getElementById("email");
  var hint = document.getElementById("college-hint");
  if (!email || !hint) return;

  var timer;
  function lookup() {
    var value = email.value.trim();
    if (value.indexOf("@") < 1 || value.split("@")[1].indexOf(".") < 1) {
      hint.textContent = "";
      hint.className = "hint";
      return;
    }
    fetch(hint.dataset.lookupUrl + "?email=" + encodeURIComponent(value))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.found) {
          hint.textContent = "You'll join " + data.name + " (" + data.campus + ").";
          hint.className = "hint hint-ok";
        } else {
          hint.textContent = "We don't support this email domain yet.";
          hint.className = "hint hint-bad";
        }
      })
      .catch(function () {});
  }

  email.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(lookup, 300);
  });
  lookup();
})();
