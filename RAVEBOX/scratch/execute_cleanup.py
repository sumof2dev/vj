import os
import shutil

WORKSPACE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP_DIR = os.path.join(WORKSPACE, "backup-unused")

# Files to move into backup-unused/ (to keep out of the active tree but preserve)
FILES_TO_MOVE = [
    # Obsolete Source Views
    "9.html",
    "profilesetup_logic.js",
    "presets_tab.html",
    "stage_tab.html",
    "test_tab.html",
    "head.html",
    "modals.html",
    
    # Root helper scripts
    "refactor.py",
    "update_engine.py",
    "web_port.py",
    
    # Orphaned scripts
    "scripts/fix_setup.py",
    "scripts/fix_setup_v2.py",
    "scripts/fix_setup_final.py",
    "scripts/fix_setup_aesthetic.py",
    "scripts/restore_active.py",
    "scripts/restore_v2.py",
    "scripts/migrate_dmx_data.py",
    "scripts/generate_profiles.py",
    "scripts/generate_sim_manifest.py",
    "scripts/generate_melody_b.py",
    "scripts/reconstruct_profiles.py",
    "scripts/rename_profiles.py",
    "scripts/calibration_proxy.py",
    "scripts/auto_scan_ehaho.py",
    "scripts/calibration_scan_ehaho.py",
    "scripts/concert_scan_ehaho.py",
    "scripts/multi_axis_scan_ehaho.py",
    "scripts/reconstruct_multi_axis_report.py",
    "scripts/resume_draw_scan_ehaho.py",
    
    # Orphaned configs
    "fixtures/profiles/govee.p.lan.json",
    "fixtures/profiles/prof_1778436571073.json",
    "fixtures/profiles/prof_1778461325957.json",
    "fixtures/profiles/prof_1778601546011.json",
    "fixtures/stages/stage_1775748504128.json",
    "fixtures/fixturebackup",
    
    # Vibe energy snaps for training
    "training_data/training_1776794259953.json",
    "training_data/training_1776804260510.json",
]

# Duplicate assets & backups that consume space and should be deleted
FILES_TO_DELETE = [
    # Redundant root duplicates (copies exist in /public/)
    "background.png",
    "background2.png",
    "background3.png",
    "background4.png",
    "favicon.ico",
    "icon.png",
    "dmxchartexample.png",
    
    # Large archive backups (848 MB total!)
    "vj_local_install.tar.gz",
    "sumof2@lappop.local",
    "vj_secondary_install.tar.gz",
    
    # Large runtime/startup logs (safe to clean up)
    "vj_startup.log",
    "launcher_debug.txt",
    "launcher.log",
    "engine.log",
    "server.log",
    "server_recovery.log",
    "dev_server.log",
    "backend.log",
]

def main():
    print("🚀 Starting RaveBox Workspace Cleanup...\n")
    os.makedirs(BACKUP_DIR, exist_ok=True)
    
    reclaimed_bytes = 0
    moved_count = 0
    deleted_count = 0

    print("--- 📂 MOVING OBSOLETE CODE & SCRIPTS TO 'backup-unused/' ---")
    for rel_path in FILES_TO_MOVE:
        src_path = os.path.join(WORKSPACE, rel_path)
        if os.path.exists(src_path):
            # Target path under backup-unused/
            dest_path = os.path.join(BACKUP_DIR, rel_path)
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            
            try:
                # Handle directory move vs file move
                if os.path.isdir(src_path):
                    if os.path.exists(dest_path):
                        shutil.rmtree(dest_path)
                    shutil.move(src_path, dest_path)
                else:
                    shutil.move(src_path, dest_path)
                print(f"Moved: {rel_path} -> backup-unused/{rel_path}")
                moved_count += 1
            except Exception as e:
                print(f"❌ Error moving {rel_path}: {e}")
        else:
            print(f"⚠️ Skipped (not found): {rel_path}")

    print("\n--- 🗑️ DELETING DUPLICATE ASSETS, HEAVY ARCHIVES, & LOGS ---")
    for rel_path in FILES_TO_DELETE:
        src_path = os.path.join(WORKSPACE, rel_path)
        if os.path.exists(src_path):
            size = os.path.getsize(src_path)
            try:
                if os.path.isdir(src_path):
                    shutil.rmtree(src_path)
                else:
                    os.remove(src_path)
                reclaimed_bytes += size
                print(f"Deleted: {rel_path} ({size:,} bytes)")
                deleted_count += 1
            except Exception as e:
                print(f"❌ Error deleting {rel_path}: {e}")
        else:
            print(f"⚠️ Skipped (not found): {rel_path}")

    reclaimed_mb = reclaimed_bytes / (1024 * 1024)
    print(f"\n✅ Cleanup Complete!")
    print(f"Moved {moved_count} obsolete files/directories to 'backup-unused/' for safekeeping.")
    print(f"Permanently deleted {deleted_count} heavy or redundant files.")
    print(f"💾 Total Disk Space Reclaimed: {reclaimed_mb:.2f} MB")

if __name__ == "__main__":
    main()
