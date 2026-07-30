import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { theme } from "@theme";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import KeyboardToolbar from "../KeyboardToolbar";
import { SEVERITY_LEVELS } from "../../shared/walkthroughSchema";
import { resolvePhotoUri } from "../../utils/inspectionPhotos";

// Renders one field of a walkthrough section instance the way the inspector
// fills it in. The form owns the answers; each field just reflects `value` and
// reports changes through `onChange`. Photo fields get a `photo` handler bag.

export function markupHasStrokes(markup) {
  if (!markup) return false;
  try {
    const parsed = typeof markup === "string" ? JSON.parse(markup) : markup;
    return Array.isArray(parsed?.strokes) && parsed.strokes.length > 0;
  } catch (_) {
    return false;
  }
}

function FieldLabel({ field }) {
  return (
    <Text style={s.label}>
      {field.label}
      {field.required ? <Text style={s.req}> *</Text> : null}
    </Text>
  );
}

// ── Text ─────────────────────────────────────────────────────────────────────
function TextField({ field, value, onChange, ai }) {
  const variant = field.config?.variant ?? "line";
  // Local state keeps typing smooth and lets the parent skip re-renders on
  // every keystroke (it only persists to the answers ref + debounced save).
  const [text, setText] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  const multiline = variant === "multiline";

  // Update local state + propagate up. Local state keeps typing smooth; the
  // parent persists to the answers ref on a debounce.
  const applyText = (t) => {
    setText(t);
    onChange(t);
  };

  // Adopt external value changes (e.g. an accepted AI rewrite applied from the
  // parent) — but only while unfocused, so a stray re-render can't clobber
  // in-progress typing.
  useEffect(() => {
    if (!focused && (value ?? "") !== text) setText(value ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // ✨ Rewrite is offered only on multiline (prose) fields that have content.
  const showAi = !!ai?.enabled && multiline && !!text.trim();

  return (
    <View style={s.block}>
      <View style={s.labelRow}>
        <FieldLabel field={field} />
        {showAi ? (
          <TouchableOpacity
            style={s.aiBtn}
            onPress={() => ai.onRequest(text)}
            disabled={ai.loading}
            hitSlop={theme?.layout?.hitSlop?.small}
            activeOpacity={0.7}
          >
            {ai.loading ? (
              <ActivityIndicator size="small" color={theme?.colors?.primary} />
            ) : (
              <>
                <MaterialCommunityIcons
                  name="auto-fix"
                  size={15}
                  color={theme?.colors?.primary}
                />
                <Text style={s.aiBtnTxt}>Rewrite</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
      <TextInput
        style={[
          s.input,
          variant === "line" && s.inputLine,
          multiline && s.inputArea,
        ]}
        value={text}
        onChangeText={applyText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        multiline={multiline}
        placeholder={multiline ? "Type here…" : ""}
        placeholderTextColor={theme?.colors?.textFine}
        textAlignVertical={multiline ? "top" : "center"}
      />
    </View>
  );
}

// ── Toggle (Yes / No) ────────────────────────────────────────────────────────
function ToggleField({ field, value, onChange }) {
  return (
    <View style={s.inlineRow}>
      <Text style={[s.label, s.labelInline]}>
        {field.label}
        {field.required ? <Text style={s.req}> *</Text> : null}
      </Text>
      <View style={s.toggle}>
        <TouchableOpacity
          style={[s.toggleBtn, value === true && s.toggleOn]}
          onPress={() => onChange(value === true ? undefined : true)}
          activeOpacity={0.8}
        >
          <Text style={[s.toggleTxt, value === true && s.toggleTxtOn]}>Yes</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.toggleBtn, value === false && s.toggleOn]}
          onPress={() => onChange(value === false ? undefined : false)}
          activeOpacity={0.8}
        >
          <Text style={[s.toggleTxt, value === false && s.toggleTxtOn]}>No</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Radio / Checkbox ─────────────────────────────────────────────────────────
function ChoiceField({ field, value, onChange, multi }) {
  const opts = field.config?.options ?? [];
  const selected = multi ? (Array.isArray(value) ? value : []) : value;

  function toggle(optId) {
    if (multi) {
      const set = new Set(selected);
      if (set.has(optId)) set.delete(optId);
      else set.add(optId);
      onChange([...set]);
    } else {
      onChange(selected === optId ? null : optId);
    }
  }

  return (
    <View style={s.block}>
      <FieldLabel field={field} />
      {opts.length === 0 && <Text style={s.muted}>No options configured.</Text>}
      {opts.map((o) => {
        const on = multi ? selected.includes(o.id) : selected === o.id;
        return (
          <TouchableOpacity
            key={o.id}
            style={s.optRow}
            onPress={() => toggle(o.id)}
            activeOpacity={0.7}
          >
            <View
              style={[
                multi ? s.checkbox : s.radio,
                on && s.markOn,
              ]}
            >
              {on && (
                <MaterialCommunityIcons
                  name={multi ? "check" : "circle"}
                  size={multi ? 13 : 10}
                  color="#fff"
                />
              )}
            </View>
            <Text style={s.optLabel}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Severity ─────────────────────────────────────────────────────────────────
function SeverityField({ field, value, onChange }) {
  return (
    <View style={s.block}>
      <FieldLabel field={field} />
      <View style={s.sevRow}>
        {SEVERITY_LEVELS.map((lvl) => {
          const on = value === lvl.key;
          return (
            <TouchableOpacity
              key={lvl.key}
              onPress={() => onChange(on ? null : lvl.key)}
              activeOpacity={0.75}
              style={[
                s.sevChip,
                on
                  ? { backgroundColor: lvl.color, borderColor: lvl.color }
                  : { backgroundColor: lvl.bg, borderColor: lvl.color },
              ]}
            >
              <View
                style={[
                  s.sevDot,
                  { backgroundColor: on ? "rgba(255,255,255,0.85)" : lvl.color },
                ]}
              />
              <Text style={[s.sevLabel, { color: on ? "#fff" : lvl.color }]}>
                {lvl.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ── Dropdown (single choice from a tap-to-open list) ─────────────────────────
// Same stored value as radio (an option id) — just a compact picker for long
// option lists, with a search box once the list gets long.
function DropdownField({ field, value, onChange }) {
  const opts = field.config?.options ?? [];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = opts.find((o) => o.id === value) ?? null;
  const searchable = opts.length > 8;
  const q = query.trim().toLowerCase();
  const filtered = q ? opts.filter((o) => o.label.toLowerCase().includes(q)) : opts;

  return (
    <View style={s.block}>
      <FieldLabel field={field} />
      <TouchableOpacity
        style={s.selectBox}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        activeOpacity={0.7}
      >
        <Text
          style={[s.selectTxt, !selected && s.selectPlaceholder]}
          numberOfLines={1}
        >
          {selected ? selected.label : "Choose…"}
        </Text>
        <MaterialCommunityIcons
          name="chevron-down"
          size={20}
          color={theme?.colors?.textSubtle}
        />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={s.ddBg}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={s.ddCard} onStartShouldSetResponder={() => true}>
            <Text style={s.ddTitle}>{field.label}</Text>
            {searchable && (
              <TextInput
                style={s.ddSearch}
                value={query}
                onChangeText={setQuery}
                placeholder="Search…"
                placeholderTextColor={theme?.colors?.textFine}
                autoFocus
              />
            )}
            <ScrollView style={s.ddList} keyboardShouldPersistTaps="handled">
              {opts.length === 0 && (
                <Text style={s.muted}>No options configured.</Text>
              )}
              {filtered.map((o) => {
                const on = o.id === value;
                return (
                  <TouchableOpacity
                    key={o.id}
                    style={s.ddRow}
                    onPress={() => {
                      onChange(on ? null : o.id);
                      setOpen(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.ddRowTxt, on && s.ddRowTxtOn]}>{o.label}</Text>
                    {on && (
                      <MaterialCommunityIcons
                        name="check"
                        size={18}
                        color={theme?.colors?.primary}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
              {opts.length > 0 && filtered.length === 0 && (
                <Text style={s.muted}>No matches.</Text>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ── Measurement (number + fixed unit) ────────────────────────────────────────
// Stored as a numeric string; the unit is configured on the field, shown as a
// suffix, and appended on the report. Local state keeps typing smooth (like the
// text field), so the parent skips a re-render per keystroke.
function MeasurementField({ field, value, onChange }) {
  const unit = field.config?.unit ?? "";
  const [text, setText] = useState(value ?? "");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused && (value ?? "") !== text) setText(value ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const apply = (t) => {
    // Keep digits, a single decimal point, and an optional leading minus.
    const cleaned = t.replace(/[^0-9.-]/g, "");
    setText(cleaned);
    onChange(cleaned);
  };

  return (
    <View style={s.block}>
      <FieldLabel field={field} />
      <View style={s.measureRow}>
        <TextInput
          style={s.measureInput}
          value={text}
          onChangeText={apply}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={theme?.colors?.textFine}
        />
        {!!unit && <Text style={s.measureUnit}>{unit}</Text>}
      </View>
    </View>
  );
}

// ── Date ─────────────────────────────────────────────────────────────────────
// Stored as an ISO "YYYY-MM-DD" string, built from local date parts to avoid a
// UTC day-shift. Reuses the app's native date picker (iOS keeps it inline;
// Android auto-dismisses).
function DateField({ field, value, onChange }) {
  const [show, setShow] = useState(false);
  const current = value ? dayjs(value) : null;
  const valid = current?.isValid();
  const pickerDate = valid ? current.toDate() : new Date();

  const onPick = (event, selected) => {
    setShow(Platform.OS === "ios");
    if (event?.type === "dismissed") {
      setShow(false);
      return;
    }
    if (selected) {
      const y = selected.getFullYear();
      const m = String(selected.getMonth() + 1).padStart(2, "0");
      const d = String(selected.getDate()).padStart(2, "0");
      onChange(`${y}-${m}-${d}`);
    }
  };

  return (
    <View style={s.block}>
      <FieldLabel field={field} />
      <TouchableOpacity
        style={s.selectBox}
        onPress={() => setShow(true)}
        activeOpacity={0.7}
      >
        <Text style={[s.selectTxt, !valid && s.selectPlaceholder]}>
          {valid ? current.format("MMM D, YYYY") : "Select a date"}
        </Text>
        <MaterialCommunityIcons
          name="calendar"
          size={18}
          color={theme?.colors?.textSubtle}
        />
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={pickerDate}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onChange={onPick}
        />
      )}
    </View>
  );
}

// ── Photos ───────────────────────────────────────────────────────────────────
function PhotoThumb({ photoRef, onPress }) {
  const [uri, setUri] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      const u = await resolvePhotoUri({
        localUri: photoRef.localUri,
        cloudUri: photoRef.cloudUri,
      });
      if (alive) {
        setUri(u);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [photoRef.localUri, photoRef.cloudUri]);

  const hasMarkup = markupHasStrokes(photoRef.markup);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={s.thumb}>
      {!!uri && (
        <Image source={{ uri }} style={s.thumbImg} resizeMode="cover" />
      )}
      {loading && (
        <View style={[StyleSheet.absoluteFillObject, s.thumbLoading]}>
          <ActivityIndicator size="small" color={theme?.colors?.primary} />
        </View>
      )}
      {!!photoRef.note && <View style={s.noteDot} />}
      {hasMarkup && (
        <View style={s.markBadge}>
          <MaterialCommunityIcons name="pencil" size={10} color="#fff" />
        </View>
      )}
    </TouchableOpacity>
  );
}

function PhotoField({ field, value, photo }) {
  const refs = Array.isArray(value) ? value : [];
  return (
    <View style={s.block}>
      <FieldLabel field={field} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.thumbRow}
        keyboardShouldPersistTaps="handled"
      >
        {refs.map((ref) => (
          <View key={ref.id} style={s.thumbContainer}>
            <PhotoThumb photoRef={ref} onPress={() => photo.onOpen(ref.id)} />
            <TouchableOpacity
              style={s.thumbDel}
              onPress={() => photo.onDelete(ref.id)}
              hitSlop={theme?.layout?.hitSlop?.medium}
            >
              <MaterialCommunityIcons name="trash-can" size={12} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={s.addThumb} onPress={photo.onCamera} activeOpacity={0.7}>
          <MaterialCommunityIcons
            name="camera-plus-outline"
            size={26}
            color={theme?.colors?.primary}
          />
        </TouchableOpacity>
        <TouchableOpacity style={s.addThumb} onPress={photo.onLibrary} activeOpacity={0.7}>
          <MaterialCommunityIcons
            name="image-plus"
            size={26}
            color={theme?.colors?.primary}
          />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// Full-screen photo viewer with note + markup + delete. The form owns which
// photo is open and supplies the handlers.
export function PhotoModal({
  visible,
  photoRef,
  onClose,
  onNoteChange,
  onMarkup,
  onDelete,
  ai,
  rewriteOverlay,
}) {
  const [uri, setUri] = useState(null);
  const [note, setNote] = useState("");
  // The card is bottom-anchored, so the keyboard would cover the note + actions.
  // Track its height to lift the card above it and float a dismiss toolbar.
  const [kbVisible, setKbVisible] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const show = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hide = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(show, (e) => {
      setKbVisible(true);
      setKbHeight(e.endCoordinates?.height ?? 0);
    });
    const onHide = Keyboard.addListener(hide, () => {
      setKbVisible(false);
      setKbHeight(0);
    });
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  const applyNote = (t) => {
    setNote(t);
    onNoteChange(t);
  };

  useEffect(() => {
    setNote(photoRef?.note ?? "");
  }, [photoRef?.id]);

  // Adopt an externally-applied note (an accepted AI rewrite). No focus guard
  // needed: typing keeps photoRef.note in sync with `note` (onNoteChange
  // re-renders immediately), so this only fires on a genuine external change —
  // and it must fire even if iOS restored focus to the note when the rewrite
  // sheet (a stacked modal) closed.
  useEffect(() => {
    if ((photoRef?.note ?? "") !== note) {
      setNote(photoRef?.note ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoRef?.note]);

  const showNoteAi = !!ai?.enabled && !!note.trim();

  useEffect(() => {
    let alive = true;
    if (!photoRef) return;
    (async () => {
      const u = await resolvePhotoUri({
        localUri: photoRef.localUri,
        cloudUri: photoRef.cloudUri,
      });
      if (alive) setUri(u);
    })();
    return () => {
      alive = false;
    };
  }, [photoRef?.localUri, photoRef?.cloudUri]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={s.modalBg}>
        <View
          style={[
            s.modalCard,
            kbVisible && { marginBottom: kbHeight + KB_TOOLBAR_GAP },
          ]}
        >
          <View
            style={[s.modalImageWrap, kbVisible && s.modalImageWrapCompact]}
          >
            {!!uri && (
              <Image source={{ uri }} style={s.modalImage} resizeMode="contain" />
            )}
          </View>
          {showNoteAi ? (
            <View style={s.noteAiRow}>
              <TouchableOpacity
                style={s.aiBtn}
                onPress={() => ai.onRequest(note)}
                disabled={ai.loading}
                hitSlop={theme?.layout?.hitSlop?.small}
                activeOpacity={0.7}
              >
                {ai.loading ? (
                  <ActivityIndicator size="small" color={theme?.colors?.primary} />
                ) : (
                  <>
                    <MaterialCommunityIcons
                      name="auto-fix"
                      size={15}
                      color={theme?.colors?.primary}
                    />
                    <Text style={s.aiBtnTxt}>Rewrite</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
          <TextInput
            style={s.modalNote}
            value={note}
            onChangeText={applyNote}
            placeholder="Add a note for this photo…"
            placeholderTextColor={theme?.colors?.textFine}
            multiline
          />
          <View style={s.modalActions}>
            <TouchableOpacity style={s.modalBtn} onPress={onMarkup} activeOpacity={0.8}>
              <MaterialCommunityIcons
                name="pencil"
                size={18}
                color={theme?.colors?.primary}
              />
              <Text style={s.modalBtnTxt}>Markup</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modalBtn, s.modalBtnDanger]}
              onPress={onDelete}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={18} color={theme?.colors?.error} />
              <Text style={[s.modalBtnTxt, { color: theme?.colors?.error }]}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modalBtn, s.modalBtnPrimary]}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <Text style={[s.modalBtnTxt, { color: "#fff" }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
        <KeyboardToolbar visible={kbVisible} keyboardHeight={kbHeight} />
        {/* The AI rewrite review surface renders here (an overlay, not a Modal)
            so it appears ON TOP of this photo modal — a stacked Modal wouldn't
            reliably present. */}
        {rewriteOverlay}
      </View>
    </Modal>
  );
}

// ── Dispatcher ───────────────────────────────────────────────────────────────
export default function WalkField({ field, value, onChange, photo, ai }) {
  switch (field.type) {
    case "heading":
      return <Text style={s.heading}>{field.label}</Text>;
    case "text":
      return <TextField field={field} value={value} onChange={onChange} ai={ai} />;
    case "toggle":
      return <ToggleField field={field} value={value} onChange={onChange} />;
    case "radio":
      return <ChoiceField field={field} value={value} onChange={onChange} multi={false} />;
    case "checkbox":
      return <ChoiceField field={field} value={value} onChange={onChange} multi />;
    case "severity":
      return <SeverityField field={field} value={value} onChange={onChange} />;
    case "dropdown":
      return <DropdownField field={field} value={value} onChange={onChange} />;
    case "measurement":
      return <MeasurementField field={field} value={value} onChange={onChange} />;
    case "date":
      return <DateField field={field} value={value} onChange={onChange} />;
    case "photo":
      return <PhotoField field={field} value={value} photo={photo} />;
    default:
      // An unknown field type (a form using a field this app build predates).
      // Degrade gracefully instead of rendering a silent blank.
      return (
        <View style={s.block}>
          <FieldLabel field={field} />
          <Text style={s.muted}>Update the app to fill in this field.</Text>
        </View>
      );
  }
}

const THUMB = 90;
// Space reserved below the lifted card for the floating dismiss toolbar.
const KB_TOOLBAR_GAP = 56;

const s = StyleSheet.create({
  block: { marginBottom: 14 },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  aiBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: theme?.colors?.primaryGhost,
    marginBottom: 7,
  },
  aiBtnTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: theme?.colors?.primary,
  },
  noteAiRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: -4 },
  heading: {
    fontSize: 16,
    fontWeight: "800",
    color: theme?.colors?.text,
    marginTop: 6,
    marginBottom: 8,
  },
  label: {
    fontSize: 13.5,
    fontWeight: "600",
    color: theme?.colors?.text,
    marginBottom: 7,
  },
  labelInline: { marginBottom: 0, flex: 1, paddingRight: 10 },
  req: { color: theme?.colors?.error, fontWeight: "700" },
  muted: { fontSize: 12.5, color: theme?.colors?.textFine, fontStyle: "italic" },

  input: {
    backgroundColor: theme?.colors?.cardBackground,
    borderRadius: theme?.layout?.borderRadius?.s ?? 8,
    borderWidth: 1,
    borderColor: theme?.colors?.input,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    color: theme?.colors?.text,
    minHeight: 42,
  },
  inputLine: {
    borderWidth: 0,
    borderBottomWidth: 1.5,
    borderRadius: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 2,
  },
  inputArea: { minHeight: 86, paddingTop: 10 },

  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  toggle: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: theme?.colors?.input,
    borderRadius: 999,
    overflow: "hidden",
  },
  toggleBtn: { paddingHorizontal: 18, paddingVertical: 7 },
  toggleOn: { backgroundColor: theme?.colors?.primary },
  toggleTxt: { fontSize: 13, fontWeight: "700", color: theme?.colors?.textSubtle },
  toggleTxtOn: { color: "#fff" },

  optRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 8,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme?.colors?.input,
    alignItems: "center",
    justifyContent: "center",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme?.colors?.input,
    alignItems: "center",
    justifyContent: "center",
  },
  markOn: {
    backgroundColor: theme?.colors?.primary,
    borderColor: theme?.colors?.primary,
  },
  optLabel: { fontSize: 15, color: theme?.colors?.text, flex: 1 },

  sevRow: { flexDirection: "row", gap: 6 },
  sevChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  sevDot: { width: 7, height: 7, borderRadius: 4 },
  sevLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },

  // Dropdown / date select box
  selectBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    backgroundColor: theme?.colors?.cardBackground,
    borderRadius: theme?.layout?.borderRadius?.s ?? 8,
    borderWidth: 1,
    borderColor: theme?.colors?.input,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 44,
  },
  selectTxt: { fontSize: 15, color: theme?.colors?.text, flex: 1 },
  selectPlaceholder: { color: theme?.colors?.textFine },

  // Dropdown modal
  ddBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  ddCard: {
    backgroundColor: theme?.colors?.cardBackground,
    borderRadius: 16,
    padding: 16,
    maxHeight: "70%",
  },
  ddTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: theme?.colors?.text,
    marginBottom: 10,
  },
  ddSearch: {
    backgroundColor: theme?.colors?.mainBackground,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme?.colors?.input,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    color: theme?.colors?.text,
    marginBottom: 8,
  },
  ddList: { flexGrow: 0 },
  ddRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme?.colors?.input,
  },
  ddRowTxt: { fontSize: 15, color: theme?.colors?.text, flex: 1 },
  ddRowTxtOn: { color: theme?.colors?.primary, fontWeight: "700" },

  // Measurement
  measureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  measureInput: {
    backgroundColor: theme?.colors?.cardBackground,
    borderRadius: theme?.layout?.borderRadius?.s ?? 8,
    borderWidth: 1,
    borderColor: theme?.colors?.input,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    color: theme?.colors?.text,
    minHeight: 42,
    minWidth: 120,
    flexShrink: 0,
  },
  measureUnit: {
    fontSize: 15,
    fontWeight: "700",
    color: theme?.colors?.textSubtle,
  },

  thumbRow: { flexDirection: "row", gap: 10, paddingVertical: 2 },
  thumbContainer: { width: THUMB, height: THUMB },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: theme?.layout?.borderRadius?.s ?? 8,
    overflow: "hidden",
    backgroundColor: theme?.colors?.input,
  },
  thumbImg: { width: THUMB, height: THUMB },
  thumbLoading: { alignItems: "center", justifyContent: "center" },
  noteDot: {
    position: "absolute",
    bottom: 5,
    right: 5,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme?.colors?.primary,
    borderWidth: 1,
    borderColor: "#fff",
  },
  markBadge: {
    position: "absolute",
    top: 4,
    left: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbDel: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme?.colors?.error,
    alignItems: "center",
    justifyContent: "center",
  },
  addThumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: theme?.layout?.borderRadius?.s ?? 8,
    borderWidth: 1,
    borderColor: theme?.colors?.primary,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme?.colors?.primaryGhost,
  },

  modalBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: theme?.colors?.cardBackground,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 28,
    gap: 12,
  },
  modalImageWrap: {
    height: 320,
    borderRadius: 12,
    backgroundColor: "#000",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  // Shrink the photo while the keyboard is up so the note + actions stay on
  // screen above it.
  modalImageWrapCompact: { height: 170 },
  modalImage: { width: "100%", height: "100%" },
  modalNote: {
    backgroundColor: theme?.colors?.mainBackground,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme?.colors?.input,
    padding: 12,
    fontSize: 15,
    color: theme?.colors?.text,
    minHeight: 60,
    textAlignVertical: "top",
  },
  modalActions: { flexDirection: "row", gap: 10 },
  modalBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme?.colors?.input,
  },
  modalBtnTxt: { fontSize: 14, fontWeight: "700", color: theme?.colors?.primary },
  modalBtnDanger: { borderColor: "rgba(220,38,38,0.4)" },
  modalBtnPrimary: {
    flex: 1,
    backgroundColor: theme?.colors?.primary,
    borderColor: theme?.colors?.primary,
  },
});
