# Cursor Startup Initialization (🔒 Do Not Edit)

Upon project load:

- Hydrate system with all rules in .cursor/rules/
- Load all files in .cursor/memory/active/  
- Enter /plan mode unless user specifies otherwise  
- Validate that memory and codebase are consistent  
- If inconsistencies found:  
    Ask user how to update memory or code  
- Confirm current active tasks  
- Summarize the project before first action

