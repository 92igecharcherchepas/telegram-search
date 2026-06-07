#include <iostream>
#include <fstream>
#include <vector>
#include <string>
#include <algorithm>
#include <iomanip>
#include <limits>

#if __cplusplus >= 201703L
    #include <filesystem>
    namespace fs = std::filesystem;
#else
    #include <experimental/filesystem>
    namespace fs = std::experimental::filesystem;
#endif

#include "json.hpp"

using namespace std;
using json = nlohmann::json;

// ============================================================
//                      STRUCTURE PROFIL
// ============================================================

struct Profil
{
    string nom;
    string prenom;
    int age;

    string email;
    string telephone;

    string adresse;
    string ville;

    string username;

    string sourceDB;
};

// ============================================================
//                      BASE DE DONNEES
// ============================================================

vector<Profil> database;

// ============================================================
//                      OUTILS STRING
// ============================================================

string toLower(string str)
{
    transform(
        str.begin(),
        str.end(),
        str.begin(),
        [](unsigned char c)
        {
            return tolower(c);
        }
    );

    return str;
}

bool containsInsensitive(const string& text, const string& query)
{
    return toLower(text).find(toLower(query)) != string::npos;
}

// ============================================================
//                      AFFICHAGE
// ============================================================

void printLine()
{
    cout << "============================================================"
         << endl;
}

void printTitle(const string& title)
{
    printLine();

    cout << " " << title << endl;

    printLine();
}

void printProfil(const Profil& p, int index)
{
    printLine();

    cout << " PROFIL #" << index << endl;

    printLine();

    cout << left << setw(15)
         << "Nom"
         << ": "
         << p.nom
         << endl;

    cout << left << setw(15)
         << "Prenom"
         << ": "
         << p.prenom
         << endl;

    cout << left << setw(15)
         << "Age"
         << ": "
         << p.age
         << endl;

    cout << left << setw(15)
         << "Username"
         << ": "
         << p.username
         << endl;

    cout << left << setw(15)
         << "Email"
         << ": "
         << p.email
         << endl;

    cout << left << setw(15)
         << "Telephone"
         << ": "
         << p.telephone
         << endl;

    cout << left << setw(15)
         << "Ville"
         << ": "
         << p.ville
         << endl;

    cout << left << setw(15)
         << "Adresse"
         << ": "
         << p.adresse
         << endl;

    cout << left << setw(15)
         << "Database"
         << ": "
         << p.sourceDB
         << endl;

    printLine();
}

// ============================================================
//                      CHARGEMENT JSON
// ============================================================

void loadSingleDatabase(const string& filepath)
{
    ifstream file(filepath);

    if (!file.is_open())
    {
        cerr << "[ERREUR] Impossible d'ouvrir : "
             << filepath
             << endl;

        return;
    }

    json j;

    try
    {
        file >> j;
    }
    catch (const exception& e)
    {
        cerr << "[ERREUR JSON] "
             << filepath
             << " -> "
             << e.what()
             << endl;

        return;
    }

    if (!j.is_array())
    {
        cerr << "[ERREUR] Le JSON doit etre un tableau : "
             << filepath
             << endl;

        return;
    }

    int loaded = 0;

    for (const auto& item : j)
    {
        Profil p;

        p.nom =
            item.value("nom", "INCONNU");

        p.prenom =
            item.value("prenom", "INCONNU");

        p.age =
            item.value("age", 0);

        p.email =
            item.value("email", "AUCUN");

        p.telephone =
            item.value("telephone", "AUCUN");

        p.adresse =
            item.value("adresse", "AUCUNE");

        p.ville =
            item.value("ville", "AUCUNE");

        p.username =
            item.value("username", "AUCUN");

        p.sourceDB =
            filepath;

        database.push_back(p);

        loaded++;
    }

    cout << "[OK] "
         << loaded
         << " profils charges depuis "
         << filepath
         << endl;
}

// ============================================================
//                  CHARGEMENT COMPLET
// ============================================================

void loadAllDatabases()
{
    string folder = "db";

    printTitle("CHARGEMENT DES DATABASES");

    if (!fs::exists(folder))
    {
        cerr << "[ERREUR] Le dossier db/ n'existe pas."
             << endl;

        return;
    }

    int totalFiles = 0;

    for (const auto& entry : fs::directory_iterator(folder))
    {
        if (entry.path().extension() == ".json")
        {
            loadSingleDatabase(entry.path().string());

            totalFiles++;
        }
    }

    cout << endl;

    printLine();

    cout << " DATABASES : "
         << totalFiles
         << endl;

    cout << " TOTAL PROFILS : "
         << database.size()
         << endl;

    printLine();
}

// ============================================================
//                      RECHERCHE
// ============================================================

vector<Profil*> searchProfils(const string& query)
{
    vector<Profil*> results;

    for (auto& p : database)
    {
        bool found = false;

        if (containsInsensitive(p.nom, query))
            found = true;

        if (containsInsensitive(p.prenom, query))
            found = true;

        if (containsInsensitive(p.email, query))
            found = true;

        if (containsInsensitive(p.telephone, query))
            found = true;

        if (containsInsensitive(p.adresse, query))
            found = true;

        if (containsInsensitive(p.ville, query))
            found = true;

        if (containsInsensitive(p.username, query))
            found = true;

        if (containsInsensitive(to_string(p.age), query))
            found = true;

        if (found)
        {
            results.push_back(&p);
        }
    }

    return results;
}

// ============================================================
//                  TRI DES RESULTATS
// ============================================================

void sortResultsByName(vector<Profil*>& results)
{
    sort(
        results.begin(),
        results.end(),
        [](Profil* a, Profil* b)
        {
            return a->nom < b->nom;
        }
    );
}

// ============================================================
//                      STATISTIQUES
// ============================================================

void showStatistics()
{
    printTitle("STATISTIQUES");

    cout << "Total profils : "
         << database.size()
         << endl;

    int withEmail = 0;
    int withPhone = 0;

    for (const auto& p : database)
    {
        if (!p.email.empty() && p.email != "AUCUN")
            withEmail++;

        if (!p.telephone.empty() && p.telephone != "AUCUN")
            withPhone++;
    }

    cout << "Profils avec email : "
         << withEmail
         << endl;

    cout << "Profils avec telephone : "
         << withPhone
         << endl;

    printLine();
}

// ============================================================
//                  EXPORT RESULTATS
// ============================================================

void exportResults(const vector<Profil*>& results)
{
    ofstream out("results.txt");

    if (!out.is_open())
    {
        cerr << "[ERREUR] Impossible de creer results.txt"
             << endl;

        return;
    }

    for (const auto* p : results)
    {
        out << "===================================="
            << endl;

        out << "Nom : "
            << p->nom
            << endl;

        out << "Prenom : "
            << p->prenom
            << endl;

        out << "Age : "
            << p->age
            << endl;

        out << "Username : "
            << p->username
            << endl;

        out << "Email : "
            << p->email
            << endl;

        out << "Telephone : "
            << p->telephone
            << endl;

        out << "Ville : "
            << p->ville
            << endl;

        out << "Adresse : "
            << p->adresse
            << endl;

        out << "Source : "
            << p->sourceDB
            << endl;
    }

    out.close();

    cout << endl;

    cout << "[OK] Resultats exportes dans results.txt"
         << endl;
}

// ============================================================
//                      MENU
// ============================================================

void menu()
{
    printTitle("KV SEARCHER ULTRA");

    cout << "1. Rechercher un profil" << endl;
    cout << "2. Voir les statistiques" << endl;
    cout << "3. Voir total profils" << endl;
    cout << "4. Quitter" << endl;

    printLine();

    cout << "Choix : ";
}

// ============================================================
//                  RECHERCHE COMPLETE
// ============================================================

void performSearch()
{
    string query;

    cout << endl;
    cout << "Recherche : ";

    getline(cin, query);

    if (query.empty())
    {
        cout << "[ERREUR] Recherche vide."
             << endl;

        return;
    }

    vector<Profil*> results =
        searchProfils(query);

    sortResultsByName(results);

    cout << endl;

    printLine();

    cout << " RESULTATS TROUVES : "
         << results.size()
         << endl;

    printLine();

    if (results.empty())
    {
        cout << "[AUCUN RESULTAT]"
             << endl;

        return;
    }

    int index = 1;

    for (const auto* p : results)
    {
        printProfil(*p, index);

        index++;
    }

    cout << endl;
    cout << "Exporter les resultats ? (y/n) : ";

    string exportChoice;

    getline(cin, exportChoice);

    if (
        exportChoice == "y" ||
        exportChoice == "Y"
    )
    {
        exportResults(results);
    }
}

// ============================================================
//                          MAIN
// ============================================================

int main()
{
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    loadAllDatabases();

    while (true)
    {
        menu();

        string choice;

        getline(cin, choice);

        // ====================================================
        // RECHERCHE
        // ====================================================

        if (choice == "1")
        {
            performSearch();
        }

        // ====================================================
        // STATS
        // ====================================================

        else if (choice == "2")
        {
            showStatistics();
        }

        // ====================================================
        // TOTAL
        // ====================================================

        else if (choice == "3")
        {
            cout << endl;

            cout << "TOTAL PROFILS : "
                 << database.size()
                 << endl;
        }

        // ====================================================
        // QUITTER
        // ====================================================

        else if (choice == "4")
        {
            cout << endl;
            cout << "Fermeture..."
                 << endl;

            break;
        }

        // ====================================================
        // CHOIX INVALIDE
        // ====================================================

        else
        {
            cout << endl;

            cout << "[ERREUR] Choix invalide."
                 << endl;
        }

        cout << endl;
    }

    return 0;
}