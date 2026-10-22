use std::fs;
use std::path::Path;

use nebo_core::library::{self, TRASH_DIR};
use nebo_core::{package, vault, DocKind, Error};

fn vault_dir() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

fn invalid(r: Result<impl std::fmt::Debug, Error>) {
    match r {
        Err(Error::Invalid(_)) => {}
        other => panic!("expected Error::Invalid, got {other:?}"),
    }
}

fn names(l: &library::Listing) -> (Vec<String>, Vec<String>) {
    (l.folders.iter().map(|f| f.name.clone()).collect(), l.notebooks.iter().map(|n| n.name.clone()).collect())
}

// ---------- path-escape safety ----------

#[test]
fn sanitize_name_produces_single_safe_components() {
    assert_eq!(library::sanitize_name("  My notes (1)  ").unwrap(), "My notes (1)");
    assert_eq!(library::sanitize_name("../../etc").unwrap(), "______etc");
    assert_eq!(library::sanitize_name("a/b\\c").unwrap(), "a_b_c");
    assert_eq!(library::sanitize_name("Ünï").unwrap(), "Ünï");
    invalid(library::sanitize_name("   "));
    invalid(library::sanitize_name(""));
}

#[test]
fn resolve_accepts_inside_and_rejects_escapes() {
    let v = vault_dir();
    let root = v.path();
    fs::create_dir(root.join("sub")).unwrap();
    assert_eq!(library::resolve(root, root).unwrap(), root);
    assert_eq!(library::resolve(root, Path::new("sub")).unwrap(), root.join("sub"));
    assert_eq!(library::resolve(root, &root.join("sub/new")).unwrap(), root.join("sub/new"));

    invalid(library::resolve(root, Path::new("../x")));
    invalid(library::resolve(root, Path::new("sub/../../x")));
    invalid(library::resolve(root, &root.join("sub/../..")));
    invalid(library::resolve(root, Path::new("/etc/passwd")));
    invalid(library::resolve(root, &root.parent().unwrap().join("sibling")));
    // hidden components: Syncthing metadata and the trash are not library content
    invalid(library::resolve(root, Path::new(".stfolder")));
    invalid(library::resolve(root, Path::new("sub/.hidden/x")));
    invalid(library::resolve(root, Path::new(".trash/old.nebo")));
}

#[cfg(unix)]
#[test]
fn resolve_rejects_symlinks_leading_outside() {
    let v = vault_dir();
    let outside = vault_dir();
    std::os::unix::fs::symlink(outside.path(), v.path().join("link")).unwrap();
    invalid(library::resolve(v.path(), Path::new("link")));
    invalid(library::resolve(v.path(), Path::new("link/inner")));
    invalid(library::create_folder(v.path(), &v.path().join("link"), "x"));
    assert!(fs::read_dir(outside.path()).unwrap().next().is_none());
}

#[test]
fn operations_never_touch_anything_outside_the_vault() {
    let base = vault_dir();
    let root = base.path().join("vault");
    fs::create_dir(&root).unwrap();
    let secret = base.path().join("secret.nebo");
    fs::write(&secret, b"outside").unwrap();
    fs::create_dir(base.path().join("elsewhere")).unwrap();
    let nb = library::create_notebook(&root, &root, "A", false).unwrap();

    invalid(library::rename(&root, &secret, "x"));
    invalid(library::rename(&root, Path::new("../secret.nebo"), "x"));
    invalid(library::trash(&root, &secret));
    invalid(library::trash(&root, Path::new("../secret.nebo")));
    invalid(library::duplicate(&root, &secret));
    invalid(library::move_to(&root, &secret, &root));
    invalid(library::move_to(&root, &nb, &base.path().join("elsewhere")));
    invalid(library::move_to(&root, &nb, Path::new("../elsewhere")));
    invalid(library::create_folder(&root, Path::new(".."), "x"));
    // a traversal in a *name* is neutralised, not followed: the folder lands inside the vault
    assert_eq!(library::create_folder(&root, &root, "../x").unwrap(), root.join("___x"));
    assert!(!base.path().join("x").exists());
    invalid(library::create_notebook(&root, Path::new("../elsewhere"), "x", false));
    invalid(library::list_dir(&root, base.path()));

    assert_eq!(fs::read(&secret).unwrap(), b"outside");
    assert!(nb.exists());
    assert!(fs::read_dir(base.path().join("elsewhere")).unwrap().next().is_none());
}

#[test]
fn the_vault_root_itself_cannot_be_renamed_moved_or_trashed() {
    let v = vault_dir();
    fs::create_dir(v.path().join("sub")).unwrap();
    invalid(library::rename(v.path(), v.path(), "x"));
    invalid(library::trash(v.path(), v.path()));
    invalid(library::move_to(v.path(), v.path(), &v.path().join("sub")));
}

// ---------- folders ----------

#[test]
fn folders_create_list_and_tree() {
    let v = vault_dir();
    let root = v.path();
    let a = library::create_folder(root, root, "Maths").unwrap();
    library::create_folder(root, &a, "Year 1").unwrap();
    library::create_folder(root, root, "art").unwrap();
    fs::create_dir(root.join(".stfolder")).unwrap(); // hidden: must not show up
    invalid(library::create_folder(root, root, "Maths")); // already exists

    let tree = library::folder_tree(root).unwrap();
    let top: Vec<_> = tree.children.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(top, ["art", "Maths"]); // case-insensitive order, hidden skipped
    assert_eq!(tree.children[1].children[0].name, "Year 1");

    let l = library::list_dir(root, root).unwrap();
    assert_eq!(names(&l), (vec!["art".into(), "Maths".into()], vec![]));
    assert_eq!(l.folders[1].items, 1);
}

#[test]
fn list_dir_lists_notebooks_and_flags_conflicts_but_hides_dotfiles() {
    let v = vault_dir();
    let root = v.path();
    let nb = library::create_notebook(root, root, "Physics", false).unwrap();
    fs::copy(&nb, root.join("Physics.sync-conflict-20260101-000000-ABCDEFG.nebo")).unwrap();
    fs::write(root.join("notes.txt"), b"x").unwrap();
    fs::write(root.join(".syncthing.Physics.nebo.tmp"), b"x").unwrap();
    let l = library::list_dir(root, root).unwrap();
    assert_eq!(l.notebooks.len(), 2);
    assert_eq!(l.notebooks.iter().filter(|n| n.is_conflict).count(), 1);
    assert!(l.folders.is_empty());
}

// ---------- notebooks ----------

#[test]
fn new_notebooks_get_unique_names_and_canvas_kind_roundtrips() {
    let v = vault_dir();
    let root = v.path();
    let a = library::create_notebook(root, root, "Untitled", false).unwrap();
    let b = library::create_notebook(root, root, "Untitled", false).unwrap();
    let c = library::create_notebook(root, root, "Board", true).unwrap();
    assert_eq!(a.file_name().unwrap(), "Untitled.nebo");
    assert_eq!(b.file_name().unwrap(), "Untitled 2.nebo");

    let (doc_a, _) = vault::load(&a).unwrap();
    assert_eq!(doc_a.kind, None);
    let (doc_c, _) = vault::load(&c).unwrap();
    assert_eq!(doc_c.kind, Some(DocKind::Canvas));
    assert_eq!(doc_c.pages.len(), 1);
    assert_eq!(doc_c.title, "Board");

    // a plain notebook writes no `kind` at all, so older readers and files stay identical
    let meta = String::from_utf8_lossy(&fs::read(&a).unwrap()).into_owned();
    assert!(!meta.contains("\"kind\""));
    // and a document without the field deserialises as a notebook
    let d: nebo_core::Document = serde_json::from_str(r#"{"title":"t","pages":[]}"#).unwrap();
    assert_eq!(d.kind, None);
    assert_eq!(package::read(&package::write(&doc_c).unwrap()).unwrap().kind, Some(DocKind::Canvas));
}

#[test]
fn rename_keeps_extension_and_refuses_collisions() {
    let v = vault_dir();
    let root = v.path();
    let a = library::create_notebook(root, root, "One", false).unwrap();
    library::create_notebook(root, root, "Two", false).unwrap();
    let f = library::create_folder(root, root, "Dir").unwrap();

    let a2 = library::rename(root, &a, "Renamed").unwrap();
    assert_eq!(a2.file_name().unwrap(), "Renamed.nebo");
    assert!(!a.exists() && a2.exists());
    assert_eq!(library::rename(root, &a2, "Again.nebo").unwrap().file_name().unwrap(), "Again.nebo");
    invalid(library::rename(root, &root.join("Again.nebo"), "Two"));
    invalid(library::rename(root, &root.join("Again.nebo"), "  "));
    assert_eq!(library::rename(root, &f, "Dir2").unwrap().file_name().unwrap(), "Dir2");
    assert!(root.join("Dir2").is_dir());
}

#[test]
fn move_into_folders() {
    let v = vault_dir();
    let root = v.path();
    let nb = library::create_notebook(root, root, "Move me", false).unwrap();
    let a = library::create_folder(root, root, "A").unwrap();
    let b = library::create_folder(root, &a, "B").unwrap();

    let moved = library::move_to(root, &nb, &a).unwrap();
    assert_eq!(moved, a.join("Move me.nebo"));
    assert!(!nb.exists() && moved.exists());
    assert_eq!(library::move_to(root, &moved, &a).unwrap(), moved); // already there: no-op

    // folders move too, but never into themselves or their own children
    invalid(library::move_to(root, &a, &a));
    invalid(library::move_to(root, &a, &b));
    let b2 = library::move_to(root, &b, root).unwrap();
    assert_eq!(b2, root.join("B"));

    // destination collision
    let other = library::create_notebook(root, root, "Move me", false).unwrap();
    invalid(library::move_to(root, &other, &a));
    assert!(other.exists());
    // destination must be a folder
    invalid(library::move_to(root, &other, &root.join("Move me.nebo")));
}

#[test]
fn duplicate_copies_bytes_with_unique_names() {
    let v = vault_dir();
    let root = v.path();
    let nb = library::create_notebook(root, root, "Orig", false).unwrap();
    let c1 = library::duplicate(root, &nb).unwrap();
    let c2 = library::duplicate(root, &nb).unwrap();
    assert_eq!(c1.file_name().unwrap(), "Orig copy.nebo");
    assert_eq!(c2.file_name().unwrap(), "Orig copy 2.nebo");
    assert_eq!(fs::read(&nb).unwrap(), fs::read(&c1).unwrap());
    // no temp file left behind for Syncthing to pick up
    assert!(fs::read_dir(root).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().starts_with(".syncthing")));

    let dir = library::create_folder(root, root, "F").unwrap();
    invalid(library::duplicate(root, &dir)); // folders can't be duplicated
    fs::write(root.join("plain.txt"), b"x").unwrap();
    invalid(library::duplicate(root, &root.join("plain.txt")));
}

#[test]
fn trash_moves_into_hidden_dir_and_never_collides() {
    let v = vault_dir();
    let root = v.path();
    let nb = library::create_notebook(root, root, "Gone", false).unwrap();
    let dir = library::create_folder(root, root, "Old").unwrap();
    fs::write(dir.join("inside.txt"), b"keep").unwrap();

    let t1 = library::trash(root, &nb).unwrap();
    assert_eq!(t1, root.join(TRASH_DIR).join("Gone.nebo"));
    assert!(t1.exists() && !nb.exists());

    let nb2 = library::create_notebook(root, root, "Gone", false).unwrap();
    let t2 = library::trash(root, &nb2).unwrap();
    assert_eq!(t2.file_name().unwrap(), "Gone 2.nebo");

    let td = library::trash(root, &dir).unwrap();
    assert_eq!(fs::read(td.join("inside.txt")).unwrap(), b"keep"); // contents survive

    // trashed items are invisible to the library and can't be addressed through it
    let l = library::list_dir(root, root).unwrap();
    assert!(l.notebooks.is_empty() && l.folders.is_empty());
    assert!(vault::list(root).unwrap().is_empty());
    invalid(library::trash(root, &t1));
    invalid(library::rename(root, &t1, "x"));
}
