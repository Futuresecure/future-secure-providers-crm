(function () {
  var SUPABASE_URL = "https://cjwxirpwzluynymwjzxl.supabase.co";
  var SUPABASE_KEY = "sb_publishable_jkr9U6yu6ODDa4JvHmrE4w_gIWJBsOz";

  function getSupabase() {
    if (window.supabase && window.supabase.createClient) {
      return Promise.resolve(window.supabase);
    }

    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src =
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

      script.onload = function () {
        resolve(window.supabase);
      };

      script.onerror = reject;

      document.head.appendChild(script);
    });
  }

  function cleanMobile(value) {
    var mobile = String(value || "").replace(/\D/g, "");

    if (mobile.length === 12 && mobile.indexOf("91") === 0) {
      mobile = mobile.slice(2);
    }

    if (mobile.length === 11 && mobile.charAt(0) === "0") {
      mobile = mobile.slice(1);
    }

    return mobile;
  }

  async function saveWebsiteLead() {
    var nameEl = document.getElementById("fspName");
    var phoneEl = document.getElementById("fspPhone");

    if (!nameEl || !phoneEl) {
      return;
    }

    var fullName = nameEl.value.trim();
    var mobile = cleanMobile(phoneEl.value);

    if (
      fullName.length < 2 ||
      !/^[6-9]\d{9}$/.test(mobile)
    ) {
      return;
    }

    var pincodeEl =
      document.getElementById("fspPincode");

    var pincode =
      pincodeEl ? pincodeEl.value.trim() : "";

    var members = [];

    document
      .querySelectorAll("#fspAges .fsp-age")
      .forEach(function (item) {
        members.push(
          item.getAttribute("data-label") +
          " (" +
          (item.value || "?") +
          ")"
        );
      });

    var medical = [];

    document
      .querySelectorAll(
        "#fspMedical input:checked"
      )
      .forEach(function (item) {
        medical.push(item.value);
      });

    var notes = [
      "Website Quote Form",
      "Members: " +
        (members.join(", ") || "-"),
      "Pincode: " +
        (pincode || "-"),
      "Medical: " +
        (
          medical.length
            ? medical.join(", ")
            : "இல்லை"
        )
    ].join("\n");

    var supabase = await getSupabase();

    var client =
      supabase.createClient(
        SUPABASE_URL,
        SUPABASE_KEY
      );

    var existing =
      await client
        .from("leads")
        .select("id")
        .eq("mobile_number", mobile)
        .limit(1);

    if (existing.error) {
      console.error(
        "Duplicate check failed:",
        existing.error.message
      );

      return;
    }

    if (
      existing.data &&
      existing.data.length
    ) {
      console.log(
        "Duplicate website lead skipped"
      );

      return;
    }

    var insert =
      await client
        .from("leads")
        .insert([
          {
            full_name: fullName,
            mobile_number: mobile,
            city: pincode
              ? "Pincode: " + pincode
              : null,
            lead_source: "Website",
            status: "New",
            next_follow_up: null,
            notes: notes
          }
        ])
        .select()
        .single();

    if (insert.error) {
      console.error(
        "Website lead save failed:",
        insert.error.message
      );

      return;
    }

    if (
      insert.data &&
      insert.data.id
    ) {
      await client
        .from("lead_activities")
        .insert([
          {
            lead_id: insert.data.id,
            activity_type: "Lead Created",
            description:
              "Lead created automatically from Website Quote Form."
          }
        ]);
    }

    console.log(
      "Website lead saved successfully"
    );
  }

  document.addEventListener(
    "click",
    function (event) {
      var button =
        event.target &&
        event.target.closest
          ? event.target.closest(
              "#fspQSubmit"
            )
          : null;

      if (!button) {
        return;
      }

      saveWebsiteLead()
        .catch(function (error) {
          console.error(
            "CRM integration error:",
            error
          );
        });
    },
    true
  );
})();
